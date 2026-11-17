#include "EngineManager.h"
#include <QJsonDocument>
#include <QJsonArray>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QTimer>
#include <QDateTime>
#include <QUuid>
#include <QGuiApplication>
#include <QWindow>
#include <QScreen>
#include <QEvent>
#include <memory>
#include <limits>
#ifdef Q_OS_LINUX
#include <sys/prctl.h>
#include <signal.h>
#include <unistd.h>
#endif

EngineManager::EngineManager(QObject* parent) : QObject(parent) { m_clock.start(); }
void EngineManager::setRenderWindow(QWindow* window) {
    if (m_renderWindow) {
        m_renderWindow->removeEventFilter(this);
        disconnect(m_renderWindow, nullptr, this, nullptr);
    }
    m_renderWindow = window;
    if (window) {
        window->installEventFilter(this);
        connect(window, &QWindow::visibilityChanged, this, [this] { updateWindowVisibility(); });
    }
    updateWindowVisibility();
}
bool EngineManager::eventFilter(QObject* watched, QEvent* event) {
    if (watched == m_renderWindow && event->type() == QEvent::Expose)
        updateWindowVisibility();
    return QObject::eventFilter(watched, event);
}
void EngineManager::updateWindowVisibility() {
    const bool visible = !m_renderWindow || (m_renderWindow->isVisible()
        && m_renderWindow->visibility() != QWindow::Minimized && m_renderWindow->isExposed());
    if (visible == m_renderVisible) return;
    m_renderVisible = visible;
    for (const auto& key : m_workers.keys()) updateWorkerRendering(key);
    if (visible) for (const auto& pane : m_panes.keys()) emit frameChanged(pane);
}
void EngineManager::updateWorkerRendering(const QString& key) {
    auto it = m_workers.find(key);
    if (it == m_workers.end() || it->process->state() != QProcess::Running) return;
    bool rendering = m_renderVisible;
    // Captures, readiness and inspection must still work while the UI is hidden.
    for (const auto& pending : m_pending) if (pending.engine == key) { rendering = true; break; }
    if (rendering == it->rendering) return;
    it->rendering = rendering;
    const QJsonObject message{{"method", "session.visibility"},
        {"params", QJsonObject{{"visible", rendering}}}};
    it->process->write(QJsonDocument(message).toJson(QJsonDocument::Compact) + '\n');
}
void EngineManager::metric(const QString& pane, const QString& name, double value) {
    if (!m_panes.contains(pane)) return;
    auto &metrics = m_metrics[pane];
    metrics[name] = metrics[name].toDouble() + value;
}
QJsonObject EngineManager::performance() const {
    QJsonObject panes;
    for (auto it=m_panes.cbegin(); it!=m_panes.cend(); ++it) panes[it.key()] = m_metrics.value(it.key());
    return {{"generation", m_generation}, {"panes", panes}, {"windowVisible", m_renderVisible},
        {"latencySemantics", "Next frame received after input dispatch: observational, not causal or display presentation"},
        {"durationUnit", "milliseconds"}};
}
EngineManager::~EngineManager() {
    m_pending.clear();
    for (const auto& key : m_workers.keys()) stop(key);
}
QJsonObject EngineManager::error(const QString& message) {
    return {{"error", QJsonObject{{"code", "ENGINE_ERROR"}, {"message", message}}}};
}
void EngineManager::dismissSelectPopups(const QString& exceptPane) {
    for (auto it=m_panes.cbegin();it!=m_panes.cend();++it) {
        if(it.key()==exceptPane)continue;
        auto worker=m_workers.value(it.value());
        if(worker.engine!="ladybird" || !worker.process || worker.process->state()!=QProcess::Running)continue;
        QJsonObject message{{"method","pane.dismissPopup"},{"params",QJsonObject{{"paneId",it.key()},{"generation",m_generation}}}};
        worker.process->write(QJsonDocument(message).toJson(QJsonDocument::Compact)+'\n');
    }
}
QString EngineManager::paneError(const QString& paneId) const {
    if (!m_panes.contains(paneId)) return "Pane has no active browser session";
    const auto worker = m_workers.value(m_panes.value(paneId));
    if (!worker.process || worker.process->state() == QProcess::NotRunning) return "Browser worker is not running";
    return m_frames.contains(paneId) ? QString{} : "Waiting for first browser frame";
}
void EngineManager::stop(const QString& key) {
    if (!m_workers.contains(key)) return;
    auto worker = m_workers.take(key);
    disconnect(worker.process, nullptr, this, nullptr);
    worker.process->closeWriteChannel();
    if (!worker.process->waitForFinished(6000)) {
        worker.process->terminate();
        if (!worker.process->waitForFinished(2000)) { worker.process->kill(); worker.process->waitForFinished(1000); }
    }
#ifdef Q_OS_LINUX
    // A renderer can be stuck after its broker exits. The group belongs solely to this worker.
    if (worker.processGroup > 0) ::kill(-worker.processGroup, SIGKILL);
#endif
    delete worker.process;
    QDir(worker.directory).removeRecursively();
    for (const auto& id : m_pending.keys()) if (m_pending.value(id).engine == key)
        m_pending.take(id).callback(error("Browser session disposed"));
}
bool EngineManager::start(const QString& key) {
    if (m_workers.contains(key)) {
        if (m_workers[key].process->state() != QProcess::NotRunning) return true;
        stop(key);
    }
    const QString engine = key.startsWith("ladybird/") ? "ladybird" : key;
    const auto env = engine == "chromium" ? "DERP_CHROMIUM_WORKER" : "DERP_LADYBIRD_WORKER";
    const auto executable = qEnvironmentVariable(env);
    if (executable.isEmpty() || !QFileInfo(executable).isExecutable()) return false;
    auto* process = new QProcess(this);
#ifdef Q_OS_LINUX
    const auto ownerPid=getpid();
    process->setChildProcessModifier([ownerPid] {
        if (setpgid(0, 0) != 0) _exit(1);
        prctl(PR_SET_PDEATHSIG, SIGTERM);
        if(getppid()!=ownerPid)_exit(1);
    });
#endif
    auto directory = QDir::current().absoluteFilePath(".local/frames/" + engine + "/" + QUuid::createUuid().toString(QUuid::WithoutBraces));
    QDir().mkpath(directory);
    auto environment = QProcessEnvironment::systemEnvironment();
    environment.insert("DERP_FRAME_DIR", directory);
    process->setProcessEnvironment(environment);
    process->setProcessChannelMode(QProcess::ForwardedErrorChannel);
    m_workers.insert(key, {process, {}, directory, engine});
    connect(process, &QProcess::readyReadStandardOutput, this, [this, key] { receive(key); });
    connect(process, &QProcess::errorOccurred, this, [this, key, process] { failWorker(key, process->errorString()); });
    connect(process, &QProcess::finished, this, [this, key](int exitCode, QProcess::ExitStatus) { failWorker(key, QString("Worker exited (%1)").arg(exitCode)); });
    QStringList arguments;
    if (engine == "chromium" && qEnvironmentVariable("DERP_HEADLESS") == "1") arguments << "--ozone-platform=headless";
    process->start(executable, arguments);
    const bool started = process->waitForStarted(5000);
    if (started) m_workers[key].processGroup = process->processId();
    return started;
}
void EngineManager::failWorker(const QString& engine, const QString& message) {
#ifdef Q_OS_LINUX
    if (m_workers.contains(engine) && m_workers[engine].process->state() == QProcess::NotRunning
        && m_workers[engine].processGroup > 0) {
        ::kill(-m_workers[engine].processGroup, SIGKILL);
        m_workers[engine].processGroup = 0;
    }
#endif
    const auto ids = m_pending.keys();
    for (const auto& id : ids) if (m_pending.value(id).engine == engine) {
        auto pending = m_pending.take(id); pending.callback(error(engine + ": " + message));
    }
    for (auto it = m_panes.cbegin(); it != m_panes.cend(); ++it) if (it.value() == engine) {
        m_frames.remove(it.key()); emit frameChanged(it.key());
    }
    emit engineError(engine + ": " + message);
    emit sessionChanged();
}
void EngineManager::send(const QString& engine, const QJsonObject& request, Callback callback) {
    if (!start(engine)) { callback(error(engine + " worker unavailable; configure its executable path")); return; }
    auto wire = request;
    const auto id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    wire["id"] = id;
    const auto pane = request["params"].toObject()["paneId"].toString();
    const auto generation = m_generation;
    const auto started = now();
    if (request["method"] == "pane.input") m_inputTime[pane] = started;
    m_pending.insert(id, {engine, [this, callback, pane, generation, started](QJsonObject reply) {
        if (generation == m_generation) { metric(pane, "engineRequests"); metric(pane, "engineRequestMs", now()-started); }
        callback(reply);
    }});
    const auto remaining = request["deadline"].toDouble() - QDateTime::currentMSecsSinceEpoch();
    QTimer::singleShot(qMax(1, int(qMin(remaining, double(std::numeric_limits<int>::max())))), this, [this, id] {
        if (m_pending.contains(id)) {
            auto pending = m_pending.take(id);
            pending.callback(error("Worker request deadline exceeded"));
            updateWorkerRendering(pending.engine);
        }
    });
    updateWorkerRendering(engine);
    m_workers[engine].process->write(QJsonDocument(wire).toJson(QJsonDocument::Compact) + '\n');
}
void EngineManager::receive(const QString& engine) {
    auto& worker = m_workers[engine]; worker.buffer += worker.process->readAllStandardOutput();
    while (true) {
        auto newline = worker.buffer.indexOf('\n'); if (newline < 0) break;
        auto line = worker.buffer.left(newline); worker.buffer.remove(0, newline + 1);
        QJsonParseError parse;
        auto message = QJsonDocument::fromJson(line, &parse).object();
        if (parse.error != QJsonParseError::NoError) { emit engineError(engine + ": invalid worker JSON"); continue; }
        if (message["event"] == "frame") { onFrame(engine, message); continue; }
        const auto id = message["id"].toString();
        if (m_pending.contains(id) && m_pending.value(id).engine == engine) {
            m_pending.take(id).callback(message);
            updateWorkerRendering(engine);
        }
    }
}
void EngineManager::onFrame(const QString& engine, const QJsonObject& event) {
    auto& worker = m_workers[engine];
    const QString pane = event["paneId"].toString();
    auto acknowledge = [&] {
        QJsonObject ack{{"method", "frame.ack"}, {"params", QJsonObject{{"paneId", pane}, {"generation", event["generation"]}, {"sequence", event["sequence"]}}}};
        worker.process->write(QJsonDocument(ack).toJson(QJsonDocument::Compact) + '\n');
    };
    if (event["generation"].toInteger() != m_generation || m_panes.value(pane) != engine) { acknowledge(); return; }
    if (!m_renderVisible) { metric(pane, "framesSkippedHidden"); acknowledge(); return; }
    const auto path = QFileInfo(event["path"].toString()).canonicalFilePath();
    const auto root = QFileInfo(worker.directory).canonicalFilePath() + '/';
    const int width = event["width"].toInt(), height = event["height"].toInt(), stride = event["stride"].toInt();
    const qint64 length = qint64(stride) * height;
    if (event["format"] != "BGRA8" || width <= 0 || height <= 0 || qint64(stride) < qint64(width) * 4 || !path.startsWith(root)) {
        emit engineError("Invalid browser frame metadata"); acknowledge(); return;
    }
    const auto started = now();
    QFile file(path);
    if (file.open(QIODevice::ReadOnly) && file.size() == length) {
        auto pixels = file.readAll();
        if (pixels.size() != length) {
            emit engineError("Incomplete browser frame"); acknowledge(); return;
        }
        // Keep the read allocation alive until the last QImage/scene-graph reader
        // releases it. The worker may reuse its file immediately after our ACK.
        const auto byteCount = pixels.size();
        auto* storage = new QByteArray(std::move(pixels));
        m_frames[pane] = QImage(reinterpret_cast<const uchar*>(storage->constData()),
            width, height, stride, QImage::Format_ARGB32_Premultiplied,
            [](void* data) { delete static_cast<QByteArray*>(data); }, storage);
        metric(pane, "framesReceived"); metric(pane, "frameBytes", byteCount);
        metric(pane, "frameReadCopyMs", now()-started);
        if (m_inputTime.contains(pane)) {
            metric(pane, "observationalNextFrameSamples");
            metric(pane, "observationalNextFrameMs", now()-m_inputTime.take(pane));
        }
        emit frameChanged(pane);
    } else emit engineError("Incomplete browser frame");
    acknowledge();
}
void EngineManager::dispatch(const QJsonObject& request, Callback callback) {
    auto effectiveRequest = request;
    auto resolveViewport = [](QJsonObject viewport) {
        if(viewport["deviceScaleFactor"].toString()=="display") {
            auto windows=QGuiApplication::topLevelWindows();
            auto density=windows.isEmpty()?QGuiApplication::primaryScreen()->devicePixelRatio():windows.first()->devicePixelRatio();
            viewport["deviceScaleFactor"]=density;
        }
        return viewport;
    };
    const auto method = request["method"].toString(); auto params = request["params"].toObject();
    if(method=="session.open") {
        QJsonArray panes;
        for(auto value:params["panes"].toArray()){auto pane=value.toObject();pane["viewport"]=resolveViewport(pane["viewport"].toObject());panes.append(pane);}
        params["panes"]=panes;
    }
    if(method=="pane.resize")params["viewport"]=resolveViewport(params["viewport"].toObject());
    effectiveRequest["params"]=params;
    if (request["deadline"].toDouble() < QDateTime::currentMSecsSinceEpoch()) { callback(error("Engine request expired")); return; }
    if (method == "performance.snapshot") { callback({{"result", performance()}}); return; }
    if (method == "engine.status") {
        struct Status { int count = 2; QJsonArray values; }; auto state = std::make_shared<Status>();
        for (const QString name : {QString("chromium"), QString("ladybird")}) {
            send(name, request, [state, callback, name](QJsonObject reply) {
                if (reply.contains("error")) state->values.append(QJsonObject{{"engine", name}, {"available", false}, {"reason", reply["error"].toObject()["message"]}});
                else state->values.append(reply["result"]);
                if (--state->count == 0) callback({{"result", state->values}});
            });
        } return;
    }
    if (method == "session.open" || method == "session.close") {
        QHash<QString, QJsonArray> groups;
        if (method == "session.open") {
            // Validate before disposing the active session.
            for (const auto& value : params["panes"].toArray()) {
                const auto engine = value.toObject()["engine"].toString();
                if (engine != "chromium" && engine != "ladybird") { callback(error("Unknown pane engine")); return; }
            }
        }
        // Ladybird's Application owns global storage/cookie jars. A process and
        // fresh profile per pane isolates even panes using the same origin.
        m_panes.clear(); m_frames.clear(); m_metrics.clear(); m_inputTime.clear();
        for (const auto& key : m_workers.keys()) if (key.startsWith("ladybird/")) stop(key);
        if (method == "session.open") {
            m_generation = params["generation"].toInteger();
            for (const auto& value : params["panes"].toArray()) {
                auto pane = value.toObject(); const auto engine = pane["engine"].toString();
                const auto key = engine == "ladybird" ? "ladybird/" + QUuid::createUuid().toString(QUuid::WithoutBraces) : engine;
                groups[key].append(pane); m_panes[pane["id"].toString()] = key;
            }
            // Dispose any previous Chromium views when the new demo has none.
            if (!groups.contains("chromium") && m_workers.contains("chromium")) groups["chromium"] = {};
        } else {
            if (m_workers.contains("chromium")) groups["chromium"] = {};
            m_generation = -1;
        }
        emit sessionChanged();
        if (groups.isEmpty()) { callback({{"result", QJsonObject{{"ok", true}}}}); return; }
        struct Aggregate { int remaining; QJsonObject failure; }; auto state = std::make_shared<Aggregate>(); state->remaining = groups.size();
        for (auto it = groups.cbegin(); it != groups.cend(); ++it) {
            auto wire = request; auto subset = params; subset["panes"] = it.value(); wire["params"] = subset;
            send(it.key(), wire, [state, callback](QJsonObject reply) {
                if (reply.contains("error")) state->failure = reply;
                if (--state->remaining == 0) callback(state->failure.isEmpty() ? QJsonObject{{"result", QJsonObject{{"ok", true}}}} : state->failure);
            });
        } return;
    }
    const auto paneId = params["paneId"].toString();
    if (params["generation"].toInteger() != m_generation || !m_panes.contains(paneId)) { callback(error("Stale or unknown pane")); return; }
    send(m_panes.value(paneId), effectiveRequest, callback);
}
