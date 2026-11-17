#pragma once
#include <QObject>
#include <QQueue>
#include <QVariantMap>
#include <QNetworkAccessManager>
#include <QTimer>
#include <QWebSocket>
#include "EngineManager.h"

class WorkspaceClient : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantMap state READ state NOTIFY stateChanged)
    Q_PROPERTY(QString error READ error NOTIFY errorChanged)
    Q_PROPERTY(bool connected READ connected NOTIFY connectedChanged)
    Q_PROPERTY(QVariantMap inspection READ inspection NOTIFY inspectionChanged)
public:
    explicit WorkspaceClient(EngineManager* engines, QObject* parent = nullptr);
    QVariantMap state() const { return m_state; }
    QVariantMap inspection() const { return m_inspection; }
    QString error() const { return m_error; }
    bool connected() const { return m_connected; }
    Q_INVOKABLE void refresh();
    Q_INVOKABLE void call(const QString& method, const QVariantMap& params = {});
    Q_INVOKABLE void clearError();
signals:
    void stateChanged();
    void errorChanged();
    void connectedChanged();
    void inspectionChanged();
    void operationCompleted(QString method, QVariant result);
    void operationFailed(QString method, QString clientRequestId);
private:
    void sendCall(const QString& method, const QVariantMap& params);
    void nextInput();
    QQueue<QVariantMap> m_inputQueue;
    bool m_inputPending = false;
    bool m_acceptInput = false;
    QNetworkRequest request(const QString& path) const;
    void setError(const QString& error);
    void connectEngine();
    void engineRequest(const QString& text);
    EngineManager* m_engines;
    QNetworkAccessManager m_network;
    QWebSocket m_engine;
    QTimer m_poll;
    QString m_base, m_token, m_error;
    QVariantMap m_state, m_inspection;
    bool m_connected = false, m_fetching = false;
};
