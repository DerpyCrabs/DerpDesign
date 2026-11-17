#include "EngineManager.h"
#include "EngineSurface.h"
#include <QtTest/QTest>
#include <QQuickWindow>
#include <QTcpServer>
#include <QTcpSocket>
#include <QEventLoop>
#include <QDateTime>
#include <QJsonArray>
#include <QJsonDocument>
#include <QTimer>
#include <QFile>
#ifdef Q_OS_LINUX
#include <unistd.h>
#endif

// Read only this test's process tree; never inspect or control desktop windows.
static qint64 childCpuTicks(qint64 pid = QCoreApplication::applicationPid()) {
    QFile children(QString("/proc/%1/task/%1/children").arg(pid));
    if (!children.open(QIODevice::ReadOnly)) return 0;
    qint64 ticks = 0;
    for (const auto& child : children.readAll().simplified().split(' ')) {
        if (child.isEmpty()) continue;
        QFile stat("/proc/" + child + "/stat");
        if (!stat.open(QIODevice::ReadOnly)) continue;
        auto fields = stat.readAll();
        const auto values = fields.mid(fields.lastIndexOf(')') + 2).split(' ');
        if (values.size() > 12) ticks += values[11].toLongLong() + values[12].toLongLong();
        ticks += childCpuTicks(child.toLongLong());
    }
    return ticks;
}

class VisibilityTest : public QObject {
    Q_OBJECT
    QTcpServer server;
    QJsonObject call(EngineManager& manager, QString method, QJsonObject params) {
        QEventLoop loop;
        QJsonObject reply;
        bool finished = false;
        manager.dispatch({{"method", method}, {"params", params},
            {"deadline", QDateTime::currentMSecsSinceEpoch() + 15000}}, [&](QJsonObject result) {
                reply = result; finished = true; loop.quit();
            });
        if (!finished) loop.exec();
        return reply;
    }
private slots:
    void initTestCase() {
        // This suite must never create windows on the user's desktop.
        QCOMPARE(QGuiApplication::platformName(), QString("offscreen"));
        QVERIFY(server.listen(QHostAddress::LocalHost));
        connect(&server, &QTcpServer::newConnection, this, [this] {
            while (auto* socket = server.nextPendingConnection()) {
                connect(socket, &QTcpSocket::readyRead, socket, [socket] {
                    socket->readAll();
                    const QByteArray html = "<!doctype html><body style='background:#145ca0'><div id='counter'>0</div>"
                        "<script>let n=0;function tick(){document.querySelector('#counter').textContent=++n;"
                        "document.body.style.background=n%2?'#145ca0':'#a05c14';requestAnimationFrame(tick)}tick()</script>";
                    socket->write("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: "
                        + QByteArray::number(html.size()) + "\r\nConnection: close\r\n\r\n" + html);
                    socket->disconnectFromHost();
                });
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
            }
        });
    }
    void suspension_data() {
        QTest::addColumn<QString>("engine");
        QTest::newRow("chromium") << QString("chromium");
        QTest::newRow("ladybird") << QString("ladybird");
    }
    void suspension() {
        QFETCH(QString, engine);
        EngineManager manager;
        QQuickWindow window;
        window.resize(320, 200);
        EngineSurface surface(window.contentItem());
        surface.setSize(QSizeF(320, 200));
        surface.setPaneId("test");
        surface.setManager(&manager);
        manager.setRenderWindow(&window);
        QVERIFY(!manager.renderingVisible());
        const QJsonObject ref{{"paneId", "test"}, {"generation", 1}};
        const QJsonObject spec{{"id", "test"}, {"engine", engine},
            {"url", QString("http://127.0.0.1:%1/").arg(server.serverPort())},
            {"viewport", QJsonObject{{"width", 320}, {"height", 200}, {"deviceScaleFactor", 1}}}};
        auto reply = call(manager, "session.open", {{"generation", 1}, {"panes", QJsonArray{spec}}});
        QVERIFY2(reply.contains("result"), qPrintable(QJsonDocument(reply).toJson()));
        // Opening and capturing an initially hidden session must wake its worker.
        reply = call(manager, "pane.capture", ref);
        QVERIFY2(reply.contains("result"), qPrintable(QJsonDocument(reply).toJson()));
        auto png = QImage::fromData(QByteArray::fromBase64(reply["result"].toObject()["pngBase64"].toString().toLatin1()));
        QCOMPARE(png.size(), QSize(320, 200));
        QVERIFY(!manager.renderingVisible());
        auto metrics = [&] { return manager.performance()["panes"].toObject()["test"].toObject(); };
        QTest::qWait(400);
        auto skipped = metrics()["framesSkippedHidden"].toDouble();
        QTest::qWait(500);
        QCOMPARE(metrics()["framesSkippedHidden"].toDouble(), skipped);
        QVERIFY(manager.frame("test").isNull());

        window.show();
        QTRY_VERIFY(manager.renderingVisible());
        QTRY_VERIFY(!manager.frame("test").isNull());
        auto frames = metrics()["framesReceived"].toDouble();
        QTRY_VERIFY(metrics()["framesReceived"].toDouble() > frames + 2);
        auto activeStart = childCpuTicks();
        QTest::qWait(800);
        auto activeTicks = childCpuTicks() - activeStart;
        // Inspect the rendered offscreen surface, not just the protocol reply.
        auto rendered = window.grabWindow();
        QVERIFY(!rendered.isNull());
        const auto color = rendered.pixelColor(250, 150);
        QVERIFY(color == QColor("#145ca0") || color == QColor("#a05c14"));

        // A capture already in flight when hidden must finish before suspension.
        bool captured = false;
        manager.dispatch({{"method", "pane.capture"}, {"params", ref},
            {"deadline", QDateTime::currentMSecsSinceEpoch() + 15000}}, [&](QJsonObject result) {
                reply = result; captured = true;
            });
        window.hide();
        QTRY_VERIFY(!manager.renderingVisible());
        QTRY_VERIFY_WITH_TIMEOUT(captured, 16000);
        QVERIFY2(reply.contains("result"), qPrintable(QJsonDocument(reply).toJson()));
        QTest::qWait(400);
        frames = metrics()["framesReceived"].toDouble();
        skipped = metrics()["framesSkippedHidden"].toDouble();
        auto hiddenStart = childCpuTicks();
        QTest::qWait(800);
        auto hiddenTicks = childCpuTicks() - hiddenStart;
#ifdef Q_OS_LINUX
        qInfo() << engine << "worker tree CPU seconds over 800ms: visible"
                << double(activeTicks) / sysconf(_SC_CLK_TCK) << "hidden"
                << double(hiddenTicks) / sysconf(_SC_CLK_TCK);
#endif
        QCOMPARE(metrics()["framesReceived"].toDouble(), frames);
        QCOMPARE(metrics()["framesSkippedHidden"].toDouble(), skipped);

        // Failed automation must release its temporary wakeup too.
        auto missing = ref; missing["selector"] = "#missing";
        QVERIFY(call(manager, "pane.inspect", missing).contains("error"));
        QTest::qWait(400);
        skipped = metrics()["framesSkippedHidden"].toDouble();
        QTest::qWait(500);
        QCOMPARE(metrics()["framesSkippedHidden"].toDouble(), skipped);
        window.show();
        QTRY_VERIFY(manager.renderingVisible());
        QTRY_VERIFY(metrics()["framesReceived"].toDouble() > frames + 2);
        QVERIFY(call(manager, "session.close", {{"generation", 1}}).contains("result"));
    }
};
QTEST_MAIN(VisibilityTest)
#include "visibility.moc"
