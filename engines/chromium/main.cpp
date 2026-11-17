#include "include/base/cef_bind.h"
#include "include/base/cef_callback.h"
#include "include/cef_app.h"
#include "include/cef_client.h"
#include "include/cef_display_handler.h"
#include "include/cef_devtools_message_observer.h"
#include "include/cef_parser.h"
#include "include/cef_render_handler.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_closure_task.h"
#include <QBuffer>
#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QImage>
#include <QPainter>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSocketNotifier>
#include <functional>
#include <QTimer>
#include <QUuid>
#include <fcntl.h>
#include <iostream>
#include <set>
#include <stdexcept>
#include <cmath>
#include <unistd.h>
static void emitJson(QJsonObject o) {
  std::cout << QJsonDocument(o).toJson(QJsonDocument::Compact).constData()
            << std::endl;
}
class Pane : public CefClient,
             public CefRenderHandler,
             public CefLoadHandler,
             public CefLifeSpanHandler,
             public CefDevToolsMessageObserver,
             public CefDisplayHandler {
public:
  static inline int live = 0;
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  void OnAfterCreated(CefRefPtr<CefBrowser> b) override {
    browser = b;
    ++live;
  }
  void OnBeforeClose(CefRefPtr<CefBrowser>) override {
    browser = nullptr;
    --live;
  }
  QString id, dir, path;
  QString loadError;
  QJsonArray logs;
  int mouseModifiers = 0;
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  bool OnConsoleMessage(CefRefPtr<CefBrowser>, cef_log_severity_t severity, const CefString& message, const CefString& source, int line) override {
    logs.append(QJsonObject{{"severity", int(severity)}, {"message", QString::fromStdString(message.ToString())}, {"source", QString::fromStdString(source.ToString())}, {"line", line}});
    const int configured = qEnvironmentVariableIntValue("DERP_LOG_LIMIT");
    const int limit = configured > 0 ? configured : 1000;
    while (logs.size() > limit) logs.removeFirst();
    return false;
  }
  void OnLoadStart(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, TransitionType) override {
    if (frame->IsMain()) { loaded = false; image = {}; viewImage = {}; popupImage = {}; popupVisible = false; loadError.clear(); }
  }
  void OnLoadError(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, ErrorCode code, const CefString& message, const CefString&) override {
    if (frame->IsMain() && code != ERR_ABORTED) loadError = QString::fromStdString(message.ToString());
  }
  int generation = 0, w = 800, h = 600, seq = 0;
  quint64 paintRevision = 0;
  double deviceScaleFactor = 1;
  bool loaded = false, pending = false, rendering = true;
  void setRendering(bool visible) {
    if (rendering == visible) return;
    rendering = visible;
    browser->GetHost()->WasHidden(!visible);
    if (visible) browser->GetHost()->Invalidate(PET_VIEW);
  }
  QImage image, viewImage, popupImage;
  CefRect popupRect;
  bool popupVisible = false;
  void compose() {
    image = viewImage.copy();
    if (popupVisible && !popupImage.isNull() && !image.isNull()) {
      QPainter painter(&image);
      painter.drawImage(QPoint(popupRect.x,
                               popupRect.y), popupImage);
    }
    pending = true;
    publish();
  }
  void OnPopupShow(CefRefPtr<CefBrowser>, bool show) override {
    popupVisible = show;
    if (!show) popupImage = {};
    compose();
  }
  void OnPopupSize(CefRefPtr<CefBrowser>, const CefRect &rect) override {
    popupRect = rect;
    compose();
  }
  CefRefPtr<CefBrowser> browser;
  CefRefPtr<CefRenderHandler> GetRenderHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  // A per-pane raster surface plus page zoom preserves CSS viewport dimensions
  // and devicePixelRatio without depending on the host display's density.
  // Each pane has its own request context, so zoom is isolated across panes.
  void GetViewRect(CefRefPtr<CefBrowser>, CefRect &r) override {
    r = CefRect(0, 0, int(std::ceil(w * deviceScaleFactor)), int(std::ceil(h * deviceScaleFactor)));
  }
  bool GetScreenInfo(CefRefPtr<CefBrowser>, CefScreenInfo &info) override {
    info.device_scale_factor = 1;
    info.depth = 32;
    info.depth_per_component = 8;
    info.rect = CefRect(0, 0, w, h);
    info.available_rect = info.rect;
    return true;
  }
  bool GetScreenPoint(CefRefPtr<CefBrowser>, int x, int y, int &screenX, int &screenY) override {
    screenX = x;
    screenY = y;
    return true;
  }
  void OnLoadEnd(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> f, int) override {
    if (f->IsMain()) {
      browser->GetHost()->SetZoomLevel(std::log(deviceScaleFactor) / std::log(1.2));
      loaded = true;
    }
  }
  void publish() {
    if (!rendering || image.isNull() || !path.isEmpty() || !pending)
      return;
    pending = false;
    path = dir + "/frame-" + QString::number(++seq) + ".bgra";
    QFile f(path);
    if (!f.open(QIODevice::WriteOnly))
      return;
    f.write((char *)image.constBits(), image.sizeInBytes());
    f.close();
    emitJson({{"event", "frame"},
              {"paneId", id},
              {"generation", generation},
              {"sequence", seq},
              {"width", image.width()},
              {"height", image.height()},
              {"stride", image.bytesPerLine()},
              {"format", "BGRA8"},
              {"path", path}});
  }
  void OnPaint(CefRefPtr<CefBrowser>, PaintElementType type, const RectList &,
               const void *p, int width, int height) override {
    if (!rendering) return;
    QImage frame = QImage((const uchar *)p, width, height, width * 4,
                   QImage::Format_ARGB32_Premultiplied)
                .copy();
    if (type == PET_VIEW) { viewImage = frame; ++paintRevision; }
    else if (type == PET_POPUP) popupImage = frame;
    else return;
    compose();
  }
  CefRefPtr<CefRegistration> observer;
  int callId = 0;
  QMap<int, QPair<bool, QJsonObject>> replies;
  void OnDevToolsMethodResult(CefRefPtr<CefBrowser>, int id, bool success,
                              const void *data, size_t size) override {
    replies[id] = {success,
                   QJsonDocument::fromJson(
                       QByteArray(static_cast<const char *>(data), size))
                       .object()};
  }
  QJsonObject cdp(const QString &method, QJsonObject params, qint64 deadline) {
    static const std::set<QString> allowed = {"DOM.getDocument",
                                              "DOM.querySelectorAll",
                                              "DOM.getNodeForLocation",
                                              "DOM.describeNode",
                                              "DOM.getBoxModel",
                                              "DOM.getOuterHTML",
                                              "CSS.enable",
                                              "DOM.enable",
                                              "CSS.getComputedStyleForNode",
                                              "CSS.getMatchedStylesForNode",
                                              "Runtime.evaluate"};
    if (!allowed.count(method))
      throw std::runtime_error("Forbidden DevTools method");
    if (!observer)
      observer = browser->GetHost()->AddDevToolsMessageObserver(this);
    int id = ++callId;
    auto value = CefParseJSON(
        QJsonDocument(params).toJson(QJsonDocument::Compact).toStdString(),
        JSON_PARSER_RFC);
    if (!browser->GetHost()->ExecuteDevToolsMethod(id, method.toStdString(),
                                                   value->GetDictionary()))
      throw std::runtime_error("DevTools dispatch failed");
    while (!replies.contains(id)) {
      if (QDateTime::currentMSecsSinceEpoch() >= deadline)
        throw std::runtime_error("Deadline expired waiting for DevTools");
      CefDoMessageLoopWork();
      usleep(1000);
    }
    auto reply = replies.take(id);
    if (!reply.first)
      throw std::runtime_error(
          QJsonDocument(reply.second).toJson().toStdString());
    return reply.second;
  }
  void waitReady(qint64 deadline) {
    for (;;) {
      if (QDateTime::currentMSecsSinceEpoch() >= deadline)
        throw std::runtime_error(QString("Deadline expired waiting for readiness: loaded=%1, frame=%2x%3, viewport=%4x%5, scale=%6").arg(loaded).arg(image.width()).arg(image.height()).arg(w).arg(h).arg(deviceScaleFactor).toStdString());
      if (!loadError.isEmpty()) throw std::runtime_error(loadError.toStdString());
      if (loaded && image.width() == int(std::ceil(w * deviceScaleFactor)) && image.height() == int(std::ceil(h * deviceScaleFactor))) {
        auto state = cdp(
            "Runtime.evaluate",
            {{"expression",
              "(() => {const h=window.__DERPDESIGN__;return {ready:document.readyState === 'complete' && (!h || h.ready === true),error:h && h.error || null,width:innerWidth,height:innerHeight,dpr:devicePixelRatio};})()"},
             {"returnByValue", true}},
            deadline);
        auto readiness = state["result"].toObject()["value"].toObject();
        if (!readiness["error"].toString().isEmpty()) throw std::runtime_error(readiness["error"].toString().toStdString());
        if (readiness["ready"].toBool() && readiness["width"].toInt() == w && readiness["height"].toInt() == h && std::abs(readiness["dpr"].toDouble() - deviceScaleFactor) < 0.0001) {
          auto previousPaint = paintRevision;
          browser->GetHost()->Invalidate(PET_VIEW);
          while (paintRevision == previousPaint) {
            if (QDateTime::currentMSecsSinceEpoch() >= deadline) throw std::runtime_error("Deadline expired waiting for ready paint");
            CefDoMessageLoopWork();
            usleep(1000);
          }
          return;
        }
      }
      CefDoMessageLoopWork();
      usleep(1000);
    }
  }
  QJsonObject inspect(QJsonObject params, qint64 deadline) {
    const bool geometryOnly = params["geometryOnly"].toBool();
    cdp("DOM.enable", {}, deadline);
    if (!geometryOnly) cdp("CSS.enable", {}, deadline);
    auto document =
        cdp("DOM.getDocument", {{"depth", geometryOnly ? 0 : -1}, {"pierce", !geometryOnly}}, deadline);
    int root = document["root"].toObject()["nodeId"].toInt(), node = 0,
        count = 1;
    QString selector = params["selector"].toString();
    if (!selector.isEmpty()) {
      auto nodes =
          cdp("DOM.querySelectorAll",
              {{"nodeId", root}, {"selector", selector}}, deadline)["nodeIds"]
              .toArray();
      count = nodes.size();
      if (count)
        node = nodes[0].toInt();
    } else if (params.contains("x") || params.contains("point")) {
      auto point =
          params.contains("point") ? params["point"].toObject() : params;
      node = cdp("DOM.getNodeForLocation",
                 {{"x", int(std::floor(point["x"].toDouble()))}, {"y", int(std::floor(point["y"].toDouble()))}}, deadline)["nodeId"]
                 .toInt();
    } else {
      selector = "html";
      auto nodes =
          cdp("DOM.querySelectorAll",
              {{"nodeId", root}, {"selector", selector}}, deadline)["nodeIds"]
              .toArray();
      if (!nodes.isEmpty())
        node = nodes[0].toInt();
    }
    if (!node)
      throw std::runtime_error("No matching element");
    auto desc = cdp("DOM.describeNode", {{"nodeId", node}, {"depth", geometryOnly ? 0 : -1}},
                    deadline)["node"]
                    .toObject();
    if (selector.isEmpty() && !geometryOnly) {
      // Picking must return a reusable selector, not an ephemeral CDP node ID.
      auto attributes = desc["attributes"].toArray();
      for (int index = 0; index + 1 < attributes.size(); index += 2) {
        if (attributes[index].toString() != "id" || attributes[index + 1].toString().isEmpty()) continue;
        QString value = attributes[index + 1].toString();
        value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\a ").replace("\r", "\\d ");
        selector = "[id=\"" + value + "\"]";
        break;
      }
      if (selector.isEmpty()) {
        std::function<QString(QJsonObject, QString)> pathTo = [&](QJsonObject current, QString path) -> QString {
          if (current["nodeId"].toInt() == node) return path;
          QMap<QString, int> siblings;
          for (const auto& childValue : current["children"].toArray()) {
            auto child = childValue.toObject();
            QString childPath = path;
            if (child["nodeType"].toInt() == 1) {
              const auto tag = child["localName"].toString();
              childPath += (path.isEmpty() ? "" : " > ") + tag + ":nth-of-type(" + QString::number(++siblings[tag]) + ")";
            }
            auto found = pathTo(child, childPath);
            if (!found.isEmpty()) return found;
          }
          return {};
        };
        selector = pathTo(document["root"].toObject(), {});
      }
      if (selector.isEmpty()) throw std::runtime_error("Element is outside supported document selector scope");
      count = cdp("DOM.querySelectorAll", {{"nodeId", root}, {"selector", selector}}, deadline)["nodeIds"].toArray().size();
    }
    std::function<QString(QJsonObject)> textContent = [&](QJsonObject n) {
      QString text =
          n["nodeType"].toInt() == 3 ? n["nodeValue"].toString() : QString();
      for (auto child : n["children"].toArray())
        text += textContent(child.toObject());
      return text;
    };
    auto box = cdp("DOM.getBoxModel", {{"nodeId", node}}, deadline)["model"]
                   .toObject();
    auto quad = box["border"].toArray();
    double x = quad[0].toDouble(), y = quad[1].toDouble();
    if (geometryOnly) return {{"geometryOnly", true}, {"element", QJsonObject{
      {"tagName", desc["localName"]}, {"framePath", QJsonArray{}},
      {"bounds", QJsonObject{{"x", x}, {"y", y}, {"width", quad[2].toDouble() - x}, {"height", quad[7].toDouble() - y}}}}}};
    QJsonObject styles;
    for (auto value : cdp("CSS.getComputedStyleForNode", {{"nodeId", node}},
                          deadline)["computedStyle"]
                          .toArray()) {
      auto style = value.toObject();
      styles[style["name"].toString()] = style["value"];
    }
    return {{"element",
             QJsonObject{
                 {"tagName", desc["localName"]},
                 {"selectors", QJsonArray{selector}},
                 {"text", textContent(desc)},
                 {"bounds", QJsonObject{{"x", x},
                                        {"y", y},
                                        {"width", quad[2].toDouble() - x},
                                        {"height", quad[7].toDouble() - y}}},
                 {"framePath", QJsonArray{}},
                 {"matchCount", count}}},
            {"computedStyles", styles},
            {"matchedStyles",
             cdp("CSS.getMatchedStylesForNode", {{"nodeId", node}}, deadline)},
            {"dom", document}, {"console", logs}, {"loadError", loadError}};
  }
  IMPLEMENT_REFCOUNTING(Pane);
};
class WorkerApp : public CefApp, public CefBrowserProcessHandler {
public:
  bool ready = false;
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
    return this;
  }
  void OnContextInitialized() override { ready = true; }
  IMPLEMENT_REFCOUNTING(WorkerApp);
};
// CEF zygote children change the stack canary on fork. The entry frame
// must not compare against the pre-fork canary when CefExecuteProcess returns.
NO_STACK_PROTECTOR int main(int argc, char **argv) {
  CefRefPtr<WorkerApp> cefApp = new WorkerApp;
  CefMainArgs args(argc, argv);
  int sub = CefExecuteProcess(args, nullptr, nullptr);
  if (sub >= 0)
    return sub;
  // CEF owns its GLib sources. Sharing Qt's GLib dispatcher leaves those
  // sources continuously ready outside CefDoMessageLoopWork.
  qputenv("QT_NO_GLIB", "1");
  QCoreApplication app(argc, argv);
  QString root = qEnvironmentVariable("DERP_FRAME_DIR");
  if (!QDir::isAbsolutePath(root)) {
    std::cerr << "DERP_FRAME_DIR must be absolute\n";
    return 2;
  }
  QDir().mkpath(root);
  CefSettings settings;
  settings.windowless_rendering_enabled = true;
  settings.external_message_pump = false;
  CefString(&settings.resources_dir_path) =
      QCoreApplication::applicationDirPath().toStdString();
  CefString(&settings.locales_dir_path) =
      QCoreApplication::applicationDirPath().toStdString() + "/locales";
  for (int i = 1; i < argc; i++)
    if (QString(argv[i]) == "--diagnostic-no-sandbox") {
      settings.no_sandbox = true;
      std::cerr << "WARNING: diagnostic sandbox disabled explicitly\n";
    }
  CefString(&settings.root_cache_path) = (root + "/storage").toStdString();
  if (!CefInitialize(args, settings, cefApp, nullptr))
    return 3;
  while (!cefApp->ready) {
    CefDoMessageLoopWork();
    usleep(1000);
  }
  QMap<QString, CefRefPtr<Pane>> panes;
  int generation = 0;
  bool rendering = true;
  QTimer timer;
  QObject::connect(&timer, &QTimer::timeout, [] { CefDoMessageLoopWork(); });
  timer.start(5);

  QByteArray input;
  fcntl(0, F_SETFL, fcntl(0, F_GETFL) | O_NONBLOCK);
  QSocketNotifier notifier(0, QSocketNotifier::Read);
  QObject::connect(&notifier, &QSocketNotifier::activated, [&] {
    char b[8192];
    ssize_t n;
    while ((n = read(0, b, sizeof b)) > 0)
      input.append(b, n);
    if (n == 0) {
      // EOF stays readable. Leaving this notifier enabled spins during CEF's
      // nested event processing and can prevent shutdown from completing.
      notifier.setEnabled(false);
      app.quit();
      return;
    }
    while (input.contains('\n')) {
      auto line = input.left(input.indexOf('\n'));
      input.remove(0, line.size() + 1);
      auto o = QJsonDocument::fromJson(line).object();
      auto p = o["params"].toObject();
      QString method = o["method"].toString();
      QJsonValue result;
      QString error;
      qint64 deadline = o.value("deadline").toVariant().toLongLong();
      if (!deadline)
        deadline = QDateTime::currentMSecsSinceEpoch() + 15000;
      try {
        if (o.contains("deadline") &&
            o["deadline"].toDouble() < QDateTime::currentMSecsSinceEpoch())
          error = "Deadline expired";
        else if (method == "session.visibility") {
          rendering = p["visible"].toBool();
          for (auto pane : panes) pane->setRendering(rendering);
          timer.setInterval(rendering ? 5 : 100);
          result = true;
        } else if (method == "engine.status")
          result = QJsonObject{
              {"engine", "chromium"},
              {"available", true},
              {"version", "CEF 156.0.30"},
              {"engineVersion", "CEF 156.0.30 Chromium 156.0.8078.96"},
              {"capabilities",
               QJsonArray{"navigation", "input", "resize", "capture", "frames",
                          "inspection", "readiness", "density", "popup-composition"}}};
        else if (method == "session.close") {
          for (auto pane : panes) {
            {
              auto browser = pane->browser;
              CefPostTask(TID_UI, base::BindOnce(
                                      [](CefRefPtr<CefBrowser> b) {
                                        b->GetHost()->CloseBrowser(true);
                                      },
                                      browser));
            }
          }
          while (Pane::live) {
            CefDoMessageLoopWork();
            usleep(1000);
          }
          for (auto pane : panes)
            QDir(pane->dir).removeRecursively();
          panes.clear();
          result = true;
        } else if (method == "session.open") {
          generation = p["generation"].toInt();
          for (auto v : p["panes"].toArray()) {
            auto spec = v.toObject();
            CefRefPtr<Pane> pane = new Pane;
            pane->id = spec["id"].toString();
            pane->generation = generation;
            auto vp = spec["viewport"].toObject();
            pane->w = vp["width"].toInt(800);
            pane->h = vp["height"].toInt(600);
            pane->deviceScaleFactor = vp["deviceScaleFactor"].toDouble(1);
            pane->dir =
                root + "/" + QUuid::createUuid().toString(QUuid::WithoutBraces);
            QDir().mkpath(pane->dir);
            CefRequestContextSettings cs;
            CefString(&cs.cache_path) =
                (root + "/storage/" +
                 QUuid::createUuid().toString(QUuid::WithoutBraces))
                    .toStdString();
            auto context = CefRequestContext::CreateContext(cs, nullptr);
            CefWindowInfo wi;
            wi.SetAsWindowless(0);
            CefBrowserSettings bs;
            if (!CefBrowserHost::CreateBrowser(
                    wi, pane, spec["url"].toString().toStdString(), bs, nullptr,
                    context)) {
              error = "Browser creation failed";
              break;
            }
            while (!pane->browser) {
              CefDoMessageLoopWork();
              usleep(1000);
            }
            pane->browser->GetHost()->SetZoomLevel(std::log(pane->deviceScaleFactor) / std::log(1.2));
            pane->setRendering(rendering);
            panes[pane->id] = pane;
          }
          result = true;
        } else {
          auto pane = panes.value(p["paneId"].toString());
          if (!pane || p["generation"].toInt() != generation)
            error = "Unknown pane or stale generation";
          else if (method == "frame.ack") {
            if (p["sequence"].toInt() == pane->seq) {
              QFile::remove(pane->path);
              pane->path.clear();
              pane->publish();
            }
            continue;
          } else if (method == "pane.resize") {
            auto vp = p["viewport"].toObject();
            pane->w = vp["width"].toInt();
            pane->h = vp["height"].toInt();
            pane->deviceScaleFactor = vp["deviceScaleFactor"].toDouble(1);
            pane->browser->GetHost()->NotifyScreenInfoChanged();
            pane->image = {};
            pane->viewImage = {};
            pane->popupImage = {};
            pane->popupVisible = false;
            pane->browser->GetHost()->SetZoomLevel(std::log(pane->deviceScaleFactor) / std::log(1.2));
            pane->browser->GetHost()->WasResized();
            pane->browser->GetHost()->Invalidate(PET_VIEW);
            result = true;
          } else if (method == "pane.reset") {
            pane->loaded = false;
            pane->browser->Reload();
            result = true;
          } else if (method == "pane.ready") {
            pane->waitReady(deadline);
            result = QJsonObject{{"kind", "document-load-and-paint"}};
          } else if (method == "pane.inspect") {
            pane->waitReady(deadline);
            result = pane->inspect(p, deadline);
          } else if (method == "pane.capture") {
            pane->waitReady(deadline);
            auto inspection = pane->inspect(p, deadline);
            QByteArray bytes;
            QBuffer buffer(&bytes);
            buffer.open(QIODevice::WriteOnly);
            pane->image.save(&buffer, "PNG");
            result = QJsonObject{
                {"generation", generation},
                {"engineVersion", "CEF 156.0.30"},
                {"pngBase64", QString::fromLatin1(bytes.toBase64())},
                {"inspection", inspection}};
          } else if (method == "pane.input") {
            auto e = p["event"].toObject();
            CefMouseEvent me;
            me.y = int(std::round(e["y"].toDouble() * pane->deviceScaleFactor));
            me.x = int(std::round(e["x"].toDouble() * pane->deviceScaleFactor));
            me.modifiers = pane->mouseModifiers;
            auto host = pane->browser->GetHost();
            auto type = e["type"].toString();
            if (type == "key" || type == "text" || e["action"] == "down")
              host->SetFocus(true);
            if (type == "pointer") {
              auto action = e["action"].toString();
              auto button = e["button"].toString();
              auto mb = button == "right"    ? MBT_RIGHT
                        : button == "middle" ? MBT_MIDDLE
                                             : MBT_LEFT;
              if (action == "move" || action == "leave")
                host->SendMouseMoveEvent(me, action == "leave");
              else if (action == "down" || action == "up") {
                const int flag = mb == MBT_RIGHT ? EVENTFLAG_RIGHT_MOUSE_BUTTON : mb == MBT_MIDDLE ? EVENTFLAG_MIDDLE_MOUSE_BUTTON : EVENTFLAG_LEFT_MOUSE_BUTTON;
                if (action == "down") pane->mouseModifiers |= flag;
                else pane->mouseModifiers &= ~flag;
                me.modifiers = pane->mouseModifiers;
                host->SendMouseClickEvent(me, mb, action == "up", 1);
              }
              else
                error = "Unsupported pointer action";
            } else if (type == "wheel") {
              host->SendMouseWheelEvent(me, int(std::round(e["deltaX"].toDouble() * pane->deviceScaleFactor)), int(std::round(e["deltaY"].toDouble() * pane->deviceScaleFactor)));
            } else if (type == "key") {
              const QString key = e["key"].toString();
              static const QMap<QString,int> codes{{"Backspace",8},{"Tab",9},{"Enter",13},{"Shift",16},{"Control",17},{"Alt",18},{"Escape",27},{" ",32},{"PageUp",33},{"PageDown",34},{"End",35},{"Home",36},{"ArrowLeft",37},{"ArrowUp",38},{"ArrowRight",39},{"ArrowDown",40},{"Delete",46},{"Meta",91}};
              CefKeyEvent event;
              event.type = e["action"].toString() == "up" ? KEYEVENT_KEYUP : KEYEVENT_RAWKEYDOWN;
              event.windows_key_code = codes.value(key, key.size() == 1 ? key.toUpper()[0].unicode() : 0);
              for (const auto& modifier : e["modifiers"].toArray()) {
                if (modifier == "shift") event.modifiers |= EVENTFLAG_SHIFT_DOWN;
                if (modifier == "control") event.modifiers |= EVENTFLAG_CONTROL_DOWN;
                if (modifier == "alt") event.modifiers |= EVENTFLAG_ALT_DOWN;
                if (modifier == "meta") event.modifiers |= EVENTFLAG_COMMAND_DOWN;
              }
              if (!event.windows_key_code) error = "Unsupported key: " + key;
              else { host->SendKeyEvent(event); if (event.type == KEYEVENT_RAWKEYDOWN && (key == "Enter" || key == "Tab")) { event.type = KEYEVENT_CHAR; event.character = event.windows_key_code; event.unmodified_character = event.character; host->SendKeyEvent(event); } }
            } else if (type == "text") {
              for (auto c : e["text"].toString()) {
                CefKeyEvent k;
                k.type = KEYEVENT_CHAR;
                k.character = c.unicode();
                k.unmodified_character = k.character;
                host->SendKeyEvent(k);
              }
            } else
              error = "Unsupported input type";
            result = true;
          } else
            error = "Unsupported method";
        }
      } catch (const std::exception &e) {
        error = QString::fromUtf8(e.what());
      }
      if (o.contains("id")) {
        if (!error.isEmpty())
          emitJson({{"id", o["id"]},
                    {"error", QJsonObject{{"code", "ENGINE_ERROR"},
                                          {"message", error}}}});
        else
          emitJson({{"id", o["id"]}, {"result", result}});
      }
    }
  });
  int rc = app.exec();
  notifier.setEnabled(false);
  timer.stop();
  for (auto pane : panes) {
    auto browser = pane->browser;
    CefPostTask(TID_UI, base::BindOnce(
                            [](CefRefPtr<CefBrowser> b) {
                              b->GetHost()->CloseBrowser(true);
                            },
                            browser));
  }
  panes.clear();
  while (Pane::live) {
    CefDoMessageLoopWork();
    usleep(1000);
  }
  CefShutdown();
  return rc;
}
