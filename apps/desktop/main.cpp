#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>
#include <QTimer>
#include "WorkspaceClient.h"
#include "EngineSurface.h"
int main(int argc, char** argv) {
    QGuiApplication app(argc, argv);
    app.setApplicationName("DerpDesign"); app.setOrganizationName("DerpDesign");
    qmlRegisterType<EngineSurface>("DerpDesign.Native", 1, 0, "EngineSurface");
    EngineManager engines;
    WorkspaceClient workspace(&engines);
    if (app.arguments().contains("--headless")) return app.exec();
    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty("workspace", &workspace);
    engine.rootContext()->setContextProperty("engines", &engines);
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed, &app, [] { QCoreApplication::exit(1); }, Qt::QueuedConnection);
    engine.loadFromModule("DerpDesign", "Main");
    engines.setRenderWindow(qobject_cast<QQuickWindow*>(engine.rootObjects().value(0)));
    const auto screenshot = qEnvironmentVariable("DERP_SCREENSHOT");
    if (!screenshot.isEmpty()) QTimer::singleShot(qEnvironmentVariableIntValue("DERP_SCREENSHOT_DELAY_MS") > 0 ? qEnvironmentVariableIntValue("DERP_SCREENSHOT_DELAY_MS") : 1800, &app, [&] {
        auto* window = qobject_cast<QQuickWindow*>(engine.rootObjects().value(0));
        const bool saved = window && window->grabWindow().save(screenshot);
        app.exit(saved ? 0 : 2);
    });
    return app.exec();
}
