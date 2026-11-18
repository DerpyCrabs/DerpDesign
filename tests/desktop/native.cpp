#include <QtQuickTest/quicktest.h>
#include <QQmlEngine>
#include <QQmlContext>
#include <QQuickItem>
#include <QQuickWindow>
#include <QtTest/QTest>
#include <QScreen>
#include <QFile>
#include <ctime>
#include <QMutex>
#include <rhi/qrhi.h>
#include "EngineSurface.h"
#include "WorkspaceClient.h"
class Setup : public QObject {
 Q_OBJECT
public slots:
 // frameSwapped can run on the render thread. Timestamp there so a busy
 // GUI thread cannot shift several completions into the same event-loop turn.
 void beginFrames(QQuickItem *item) {
   auto *window = item->window();
   QMutexLocker lock(&frameMutex);
   frameTimes.clear();
   gpuFrameMs = 0;
   gpuSamples = 0;
   device.clear();
   frameClock.start();
   cpuStart = std::clock();
   countersStart = frameCounters();
   frameConnection = connect(window, &QQuickWindow::frameSwapped, this, [this, window] {
     QMutexLocker lock(&frameMutex);
     frameTimes.append(frameClock.nsecsElapsed() / 1e6);
     if (auto *swapChain = window->swapChain()) {
       const double elapsed = swapChain->currentFrameCommandBuffer()->lastCompletedGpuTime();
       if (elapsed > 0) { gpuFrameMs += elapsed * 1000; ++gpuSamples; }
     }
     if (device.isEmpty() && window->rhi()) {
       const auto info = window->rhi()->driverInfo();
       const auto name = info.deviceName.toLower();
       device = {{"name", QString::fromUtf8(info.deviceName)},
                 {"backend", window->rhi()->backendName()},
                 {"hardware", !name.isEmpty() && info.deviceType != QRhiDriverInfo::CpuDevice
                        && !name.contains("llvmpipe") && !name.contains("softpipe")
                        && !name.contains("swiftshader")}};
     }
   }, Qt::DirectConnection);
 }
 QVariantMap endFrames(QQuickItem *item) {
   disconnect(frameConnection);
   QMutexLocker lock(&frameMutex);
   QVariantMap counters;
   const auto current = frameCounters();
   for (auto it = current.begin(); it != current.end(); ++it)
     counters[it.key()] = it.value() - countersStart.value(it.key());
   return {{"hostCpuMs", 1000.0 * (std::clock() - cpuStart) / CLOCKS_PER_SEC}, {"engine", counters},
           {"gpuFrameMs", gpuFrameMs}, {"gpuSamples", gpuSamples}, {"timestamps", frameTimes}, {"device", device},
           {"durationMs", frameClock.nsecsElapsed() / 1e6},
           {"refreshHz", item->window()->screen()->refreshRate()},
           {"scale", item->window()->devicePixelRatio()}};
 }
 void dragEvent(QQuickItem *item, QString action, int x, int y) {
   auto *window = item->window();
   const QPointF point = item->mapToScene(QPointF(x,y));
   const bool move = action == "move", release = action == "release";
   QMouseEvent event(move ? QEvent::MouseMove : release ? QEvent::MouseButtonRelease : QEvent::MouseButtonPress,
                     point, window->mapToGlobal(point.toPoint()), move ? Qt::NoButton : Qt::LeftButton,
                     release ? Qt::NoButton : Qt::LeftButton, Qt::NoModifier);
   QCoreApplication::sendEvent(window, &event);
 }
 bool benchmarkReady() const { return QFile::exists(qEnvironmentVariable("DERP_READY_FILE")); }
 QString renderedPixel(QQuickItem *item, double x, double y) {
   auto *window = item->window();
   const auto image = window->grabWindow();
   const auto point = item->mapToScene(QPointF(x, y)) * image.devicePixelRatio();
   return image.pixelColor(point.toPoint()).name();
 }
 bool saveWindow(QQuickItem *item, const QString &path) { return item->window()->grabWindow().save(path); }
 void typeItem(QQuickItem *item, const QString &text) {
   for (auto character : text) {
     QKeyEvent press(QEvent::KeyPress, 0, Qt::NoModifier, QString(character));
     QCoreApplication::sendEvent(item->window(), &press);
     QKeyEvent release(QEvent::KeyRelease, 0, Qt::NoModifier, QString(character));
     QCoreApplication::sendEvent(item->window(), &release);
   }
 }
 void clickItem(QQuickItem *item) {
   auto *window = item->window();
   window->requestActivate();
   QTest::mouseClick(window, Qt::LeftButton, Qt::NoModifier,
                    item->mapToScene(QPointF(item->width()/2,item->height()/2)).toPoint());
 }
 void keyItem(QQuickItem *item, int key, int modifiers = 0) {
   QTest::keyClick(item->window(), static_cast<Qt::Key>(key),
                  static_cast<Qt::KeyboardModifiers>(modifiers));
 }

 void qmlEngineAvailable(QQmlEngine *engine) {
  engine->rootContext()->setContextProperty("nativeInput", this);
  qmlRegisterType<EngineSurface>("DerpDesign.Native",1,0,"EngineSurface");
  engine->rootContext()->setContextProperty("engines", &engines);
  if (qEnvironmentVariableIsSet("DERP_NATIVE_REAL")) {
    workspace = new WorkspaceClient(&engines, this);
    engine->rootContext()->setContextProperty("workspace", workspace);
  }
 }
private:
 std::clock_t cpuStart{};
 QMap<QString,double> countersStart;
 QMap<QString,double> frameCounters() const {
   QMap<QString,double> sums;
   const auto panes = engines.performance()["panes"].toObject();
   for (const auto &pane : panes) {
     const auto metrics = pane.toObject();
     for (const auto key : {"framesReceived", "frameBytes", "dirtyBoundsBytes", "dirtyBytes", "textureAllocations", "textureStageMs", "textureStageBytes", "fullTextureBytes", "frameReadCopyMs", "engineRequestMs", "nativeInputSent"})
       sums[key] += metrics[key].toDouble();
   }
   return sums;
 }
 double gpuFrameMs = 0;
 int gpuSamples = 0;
 QMutex frameMutex;
 QMetaObject::Connection frameConnection;
 QElapsedTimer frameClock;
 QVariantList frameTimes;
 QVariantMap device;
 EngineManager engines; WorkspaceClient* workspace = nullptr;
};
QUICK_TEST_MAIN_WITH_SETUP(desktop, Setup)
#include "native.moc"
