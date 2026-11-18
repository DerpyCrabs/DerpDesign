#include "WorkspaceClient.h"
#include <QNetworkReply>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QDateTime>
#include <QUuid>
#include <QSettings>

WorkspaceClient::WorkspaceClient(EngineManager* engines, QObject* parent) : QObject(parent), m_engines(engines) {
    m_base = qEnvironmentVariable("DERP_WORKSPACE_URL", "http://127.0.0.1:47831");
    m_token = qEnvironmentVariable("DERP_DESKTOP_TOKEN");
    connect(&m_poll, &QTimer::timeout, this, &WorkspaceClient::refresh);
    connect(&m_engine, &QWebSocket::textMessageReceived, this, &WorkspaceClient::engineRequest);
    connect(m_engines, &EngineManager::engineError, this, &WorkspaceClient::setError);
    m_poll.start(1500);
    if (m_token.isEmpty()) setError("Desktop credential missing. Launch with the DerpDesign launcher.");
    else { refresh(); connectEngine(); }
}
QVariantMap WorkspaceClient::savedCanvas() const {
    const auto path = qEnvironmentVariable("DERP_CANVAS_SETTINGS");
    if (path.isEmpty()) return {};
    return QSettings(path, QSettings::IniFormat).value("canvas").toMap();
}
void WorkspaceClient::saveCanvas(const QVariantMap& view) {
    const auto path = qEnvironmentVariable("DERP_CANVAS_SETTINGS");
    if (path.isEmpty()) return;
    QSettings settings(path, QSettings::IniFormat);
    settings.setValue("canvas", view);
}
QNetworkRequest WorkspaceClient::request(const QString& path) const {
    QNetworkRequest req(QUrl(m_base + path));
    req.setRawHeader("Authorization", "Bearer " + m_token.toUtf8());
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    bool validTimeout = false;
    auto timeout = qEnvironmentVariable("DERP_REQUEST_TIMEOUT_MS", "300000").toInt(&validTimeout);
    req.setTransferTimeout(validTimeout && timeout > 0 ? timeout : 300000);
    return req;
}
void WorkspaceClient::setError(const QString& error) {
    if (m_error == error) return;
    m_error = error; emit errorChanged();
}
void WorkspaceClient::clearError() { setError({}); }
void WorkspaceClient::refresh() {
    if (m_fetching || m_token.isEmpty()) return;
    m_fetching = true;
    auto* reply = m_network.get(request("/state"));
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        m_fetching = false;
        const bool ok = reply->error() == QNetworkReply::NoError;
        if (m_connected != ok) { m_connected = ok; emit connectedChanged(); }
        if (ok) {
            auto state = QJsonDocument::fromJson(reply->readAll()).object().toVariantMap();
            m_acceptInput = !state.value("selection").toMap().value("demoId").toString().isEmpty();
            if (state != m_state) {
                if (state.value("selection").toMap() != m_state.value("selection").toMap()) m_inputQueue.clear();
                m_state = state;
                emit stateChanged();
            }
            if (m_engine.state() == QAbstractSocket::UnconnectedState) connectEngine();
        } else setError(reply->errorString());
        reply->deleteLater();
    });
}
void WorkspaceClient::call(const QString& method, const QVariantMap& params) {
    if (method == "selection.set") { m_acceptInput = false; m_inputQueue.clear(); }
    if (method != "pane.input") { sendCall(method, params); return; }
    if (!m_acceptInput) return;
    const auto selection = m_state.value("selection").toMap();
    bool active = false;
    for (const auto &value : m_state.value("demos").toList()) {
        const auto demo = value.toMap();
        if (demo.value("id") != selection.value("demoId")) continue;
        for (const auto &pane : demo.value("panes").toList())
            if (pane.toMap().value("id") == params.value("paneId")) active = true;
    }
    if (!active) return;
    m_engines->metric(params.value("paneId").toString(), "nativeInputReceived");
    auto input = params;
    input["_queuedAt"] = m_engines->now();
    input["expectedGeneration"] = selection.value("generation");
    const auto event = params.value("event").toMap();
    // Only collapse consecutive motion. Never cross a click, leave, wheel or key.
    if (!m_inputQueue.isEmpty() && event.value("type") == "pointer" && event.value("action") == "move") {
        auto &last = m_inputQueue.back();
        const auto previous = last.value("event").toMap();
        if (last.value("paneId") == params.value("paneId") && previous.value("type") == "pointer" && previous.value("action") == "move") {
            m_engines->metric(params.value("paneId").toString(), "nativeInputCoalesced");
            last = input;
            return;
        }
    }
    m_engines->metric(params.value("paneId").toString(), "nativeInputPending", 1);
    m_inputQueue.enqueue(input);
    nextInput();
}
void WorkspaceClient::nextInput() {
    if (m_inputPending || m_inputQueue.isEmpty()) return;
    m_inputPending = true;
    auto input = m_inputQueue.dequeue();
    const auto pane = input.value("paneId").toString();
    m_engines->metric(pane, "nativeInputPending", -1);
    m_engines->metric(pane, "nativeInputSent");
    m_engines->metric(pane, "nativeQueueWaitMs", m_engines->now()-input.take("_queuedAt").toDouble());
    sendCall("pane.input", input);
}
void WorkspaceClient::sendCall(const QString& method, const QVariantMap& params) {
    auto wireParams = params;
    wireParams.remove("clientRequestId");
    wireParams.remove("clientPurpose");
    if (method == "pane.inspect" && params.value("clientPurpose").toString() == "hover") wireParams["geometryOnly"] = true;
    auto body = QJsonObject{{"id", QUuid::createUuid().toString(QUuid::WithoutBraces)},
                           {"method", method}, {"params", QJsonObject::fromVariantMap(wireParams)}};
    const auto generation = m_state.value("selection").toMap().value("generation");
    auto* reply = m_network.post(request("/rpc"), QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply, method, params, generation] {
        auto body = QJsonDocument::fromJson(reply->readAll()).object();
        if (reply->error() != QNetworkReply::NoError) { setError(reply->errorString()); emit operationFailed(method, params.value("clientRequestId").toString()); }
        else if (body.contains("error")) { setError(body["error"].toObject()["message"].toString()); emit operationFailed(method, params.value("clientRequestId").toString()); }
        else {
            if (method == "pane.inspect") {
                auto inspection = body["result"].toObject();
                inspection["paneId"] = params.value("paneId").toString();
                inspection["clientRequestId"] = params.value("clientRequestId").toString();
                inspection["clientPurpose"] = params.value("clientPurpose").toString();
                inspection["generation"] = QJsonValue::fromVariant(generation);
                body["result"] = inspection;
                if (params.value("clientPurpose").toString() != "hover") { m_inspection = inspection.toVariantMap(); emit inspectionChanged(); }
            }
            emit operationCompleted(method, body["result"].toVariant());
            if (method != "pane.input" && method != "pane.inspect") refresh();
        }
        reply->deleteLater();
        if (method == "pane.input") { m_inputPending = false; nextInput(); }
    });
}
void WorkspaceClient::connectEngine() {
    auto req = request("/engine"); auto url = req.url(); url.setScheme("ws"); req.setUrl(url);
    m_engine.open(req);
}
void WorkspaceClient::engineRequest(const QString& text) {
    auto msg = QJsonDocument::fromJson(text.toUtf8()).object();
    if (msg.value("method") == "session.close") {
        m_acceptInput = false;
        m_inputQueue.clear();
    }
    if (msg.value("method") == "performance.snapshot") {
        auto result = m_engines->performance();
        auto panes = result["panes"].toObject();
        for (auto it=panes.begin(); it!=panes.end(); ++it) {
            auto metrics = it.value().toObject();
            int queued = 0;
            for (const auto &input : m_inputQueue) if (input.value("paneId").toString()==it.key()) ++queued;
            metrics["nativeInputPending"] = queued;
            it.value() = metrics;
        }
        result["panes"] = panes;
        m_engine.sendTextMessage(QString::fromUtf8(QJsonDocument(QJsonObject{{"id",msg["id"]},{"result",result}}).toJson(QJsonDocument::Compact)));
        return;
    }
    m_engines->dispatch(msg, [this, id = msg.value("id")](QJsonObject response) {
        response["id"] = id;
        m_engine.sendTextMessage(QString::fromUtf8(QJsonDocument(response).toJson(QJsonDocument::Compact)));
    });
}
