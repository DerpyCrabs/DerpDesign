#pragma once
#include <QObject>
#include <QProcess>
#include <QJsonObject>
#include <QImage>
#include <QHash>
#include <QElapsedTimer>
#include <QPointer>
#include <QWindow>
#include <QTemporaryDir>
#include <memory>
#include <functional>
class EngineManager : public QObject {
    Q_OBJECT
public:
    using Callback = std::function<void(QJsonObject)>;
    explicit EngineManager(QObject* parent = nullptr);
    ~EngineManager() override;
    void setRenderWindow(QWindow* window);
    bool renderingVisible() const { return m_renderVisible; }
    void dispatch(const QJsonObject& request, Callback callback);
    QJsonObject performance() const;
    void metric(const QString& pane, const QString& name, double value = 1);
    double now() const { return m_clock.nsecsElapsed() / 1000000.0; }
    QImage frame(const QString& paneId) const { return m_frames.value(paneId); }
    Q_INVOKABLE QSize frameSize(const QString& paneId) const { return m_frames.value(paneId).size(); }
    Q_INVOKABLE void dismissSelectPopups(const QString& exceptPane = {});
    Q_INVOKABLE QString paneError(const QString& paneId) const;
signals:
    void frameChanged(QString paneId);
    void frameUpdated(QString paneId, QRect region);
    void sessionChanged();
    void engineError(QString message);
private:
    bool eventFilter(QObject* watched, QEvent* event) override;
    void updateWindowVisibility();
    void updateWorkerRendering(const QString& key);
    QPointer<QWindow> m_renderWindow;
    bool m_renderVisible = true; // Headless automation has no window to hide.
    struct Worker { QProcess* process = nullptr; QByteArray buffer; QString directory; QString engine; qint64 processGroup = 0; bool rendering = true; std::shared_ptr<QTemporaryDir> profile; };
    struct Pending { QString engine; Callback callback; };
    QHash<QString, Worker> m_workers;
    QHash<QString, Pending> m_pending;
    QHash<QString, QString> m_panes;
    QHash<QString, QImage> m_frames;
    QElapsedTimer m_clock;
    QHash<QString, QJsonObject> m_metrics;
    QHash<QString, double> m_inputTime;
    qint64 m_generation = -1;
    bool start(const QString& worker);
    void stop(const QString& worker);
    void send(const QString& engine, const QJsonObject& request, Callback callback);
    void receive(const QString& engine);
    void onFrame(const QString& engine, const QJsonObject& event);
    void failWorker(const QString& engine, const QString& message);
    static QJsonObject error(const QString& message);
};
