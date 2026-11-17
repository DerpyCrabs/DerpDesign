#include <QtQuickTest/quicktest.h>
#include <QQmlEngine>
#include <QQmlContext>
#include <QQuickItem>
#include <QQuickWindow>
#include <QtTest/QTest>
#include "EngineSurface.h"
#include "WorkspaceClient.h"
class Setup : public QObject {
 Q_OBJECT
public slots:
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
private: EngineManager engines; WorkspaceClient* workspace = nullptr;
};
QUICK_TEST_MAIN_WITH_SETUP(desktop, Setup)
#include "native.moc"
