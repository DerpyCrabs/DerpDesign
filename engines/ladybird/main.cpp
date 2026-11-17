#include "input.h"
#include "inspection.h"
#include "log_filter.h"
#include "select_popup.h"
#include <AK/LexicalPath.h>
#include <LibCore/Notifier.h>
#include <LibCore/Timer.h>
#include <LibGfx/Bitmap.h>
#include <LibGfx/SystemTheme.h>
#include <LibMain/Main.h>
#include <LibURL/Parser.h>
#include <LibWebView/Application.h>
#include <LibWebView/ConsoleOutput.h>
#include <LibWebView/CookieJar.h>
#include <LibWebView/HeadlessWebView.h>
#include <LibWebView/Utilities.h>
#include <LibWebView/WebContentClient.h>
#include <QBuffer>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QGuiApplication>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSet>
#include <QUuid>
#include <cstdio>
#include <csignal>
#include <functional>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <unistd.h>
#include <vector>

class AdapterApplication final : public WebView::Application {
  WEB_VIEW_APPLICATION(AdapterApplication)
  AdapterApplication() = default;
};

static void send_json(QJsonObject object) {
  auto bytes = QJsonDocument(object).toJson(QJsonDocument::Compact);
  fwrite(bytes.data(), 1, bytes.size(), stdout);
  fputc('\n', stdout);
  fflush(stdout);
}
class Pane final : public WebView::HeadlessWebView {
public:
  Pane(Core::AnonymousBuffer theme, int w, int h, double scale)
      : HeadlessWebView(move(theme), {int(std::round(w * scale)),
                                      int(std::round(h * scale))}) {
    m_device_pixel_ratio = scale;
    initialize_client(CreateNewClient::Yes);
    resize(w, h, scale);
    popup.closed = [this](std::optional<u32> choice) {
      select_dropdown_closed(choice.has_value() ? Optional<u32>(*choice)
                                                : Optional<u32>{});
      pending = true;
      publish();
    };
    on_request_select_dropdown = [this](Gfx::IntPoint position,
                                        i32 minimumWidth,
                                        Vector<Web::HTML::SelectItem> items) {
      popup.show(position, minimumWidth, items, density, width, height);
      pending = true;
      publish();
    };
  }
  QString id, dir, path, initialUrl;
  int generation = 0, sequence = 0, width = 0, height = 0;
  bool loaded = false, pending = false, rendering = true;
  void setRendering(bool visible) {
    if (rendering == visible) return;
    rendering = visible;
    set_system_visibility_state(visible ? Web::HTML::VisibilityState::Visible
                                       : Web::HTML::VisibilityState::Hidden);
    if (visible) debug_request("set-line-box-borders", "off");
  }
  QImage pixels;
  SelectPopup popup;
  QImage composed() const {
    auto image = pixels;
    popup.draw(image, density);
    return image;
  }
  QString input(QJsonObject const &event) {
    bool handled = popup.input(event);
    if (handled && event["type"] == "pointer" && event["action"] == "up")
      buttons = Web::UIEvents::MouseButton::None;
    if (handled) {
      pending = true;
      publish();
    }
    return handled ? QString{} : send_input(*this, event, buttons, density);
  }
  Web::UIEvents::MouseButton buttons = Web::UIEvents::MouseButton::None;
  quint64 navigationEpoch = 0, paintRevision = 0, capturePaintRevision = 0;
  QString captureKey;
  QString inputKey, lastError;
  bool crashed = false;
  QString queryKey;
  bool querying = false;
  std::optional<QJsonObject> queryResult;
  void focus() { client().async_set_has_focus(page_id(), true); }
  bool input_idle() const { return m_pending_input_events.is_empty(); }
  std::optional<QJsonObject> query(QString const &key,
                                   QJsonObject const &params) {
    if (queryKey == key && queryResult.has_value())
      return queryResult;
    if (querying)
      return {};
    queryKey = key;
    queryResult.reset();
    querying = true;
    queryPayload.clear();
    queryChunkIndex = queryChunkTotal = 0;
    auto tagged = params;
    tagged["__derpQueryId"] = key;
    // Console evaluation can retain a detached iframe realm. The page API
    // explicitly executes in the current top-level document's realm instead.
    // Keep every duplicate stderr record below PIPE_BUF, so separate child
    // processes cannot splice warnings into the middle of a transport record.
    auto token = QString::fromUtf8(QJsonDocument(QJsonObject{{"id", key}}).toJson(QJsonDocument::Compact));
    auto script = (QStringLiteral("(()=>{let text=") + inspection_script(tagged)
        + QStringLiteral(";const id=(") + token + QStringLiteral(").id;if(text.length>8388608)text=JSON.stringify({__derpQueryId:id,error:'Inspection result exceeds transport limit'});const total=Math.ceil(text.length/512);for(let index=0;index<total;index++)console.debug('__DERPDESIGN_INSPECTION__',JSON.stringify({id,index,total,data:text.slice(index*512,(index+1)*512)}));})()")).toUtf8();
    run_javascript(
        MUST(String::from_utf8(StringView(script.constData(), script.size()))));
    return {};
  }
  QString queryPayload;
  int queryChunkIndex = 0, queryChunkTotal = 0;
  void accept_query_chunk(QString const &text) {
    if (!querying) return;
    auto envelope = QJsonDocument::fromJson(text.toUtf8()).object();
    if (envelope["id"].toString() != queryKey) return;
    const int index = envelope["index"].toInt(-1), total = envelope["total"].toInt(-1);
    const auto data = envelope["data"].toString();
    if (total < 1 || total > 16384 || index != queryChunkIndex || data.size() > 512
        || (queryChunkIndex && total != queryChunkTotal)) {
      querying = false; queryPayload.clear();
      queryResult = QJsonObject{{"error", "Invalid inspection transport chunk"}};
      return;
    }
    queryChunkTotal = total;
    queryPayload += data;
    if (++queryChunkIndex != total) return;
    auto document = QJsonDocument::fromJson(queryPayload.toUtf8());
    queryPayload.clear();
    querying = false;
    if (!document.isObject()) { queryResult = QJsonObject{{"error", "Invalid inspection JSON"}}; return; }
    auto object = document.object();
    if (object.take("__derpQueryId").toString() != queryKey) {
      queryResult = QJsonObject{{"error", "Inspection transport token mismatch"}}; return;
    }
    queryResult = object;
  }
  void finish_query() {
    queryPayload.clear();
    queryChunkIndex = queryChunkTotal = 0;
    queryKey.clear();
    queryResult.reset();
    querying = false;
  }
  double density = 1;
  void resize(int w, int h, double scale) {
    popup.close();
    density = scale;
    m_device_pixel_ratio = scale;
    client().async_set_device_pixel_ratio(page_id(), scale);
    width = int(std::round(w * scale));
    height = int(std::round(h * scale));
    pixels = {};
    on_resize_window(Gfx::IntSize{width, height});
  }
  void paint() {
    if (!rendering) return;
    auto const &front = m_client_state.front_bitmap;
    if (!front.bitmap || front.last_painted_size.width().value() != width ||
        front.last_painted_size.height().value() != height)
      return;
    ++paintRevision;
    pixels = QImage(front.bitmap->scanline_u8(0), width, height,
                    front.bitmap->pitch(), QImage::Format_ARGB32_Premultiplied)
                 .copy();
    pending = true;
    publish();
  }
  void publish() {
    if (!rendering || !path.isEmpty() || pixels.isNull() || !pending)
      return;
    pending = false;
    path = dir + QString("/frame-%1.bgra").arg(++sequence);
    QFile file(path);
    auto output = composed();
    if (!file.open(QIODevice::WriteOnly) ||
        file.write(reinterpret_cast<char const *>(output.constBits()),
                   output.sizeInBytes()) != output.sizeInBytes()) {
      path.clear();
      return;
    }
    file.close();
    send_json({{"event", "frame"},
               {"paneId", id},
               {"generation", generation},
               {"sequence", sequence},
               {"width", width},
               {"height", height},
               {"stride", pixels.bytesPerLine()},
               {"format", "BGRA8"},
               {"path", path}});
  }
  ~Pane() { QDir(dir).removeRecursively(); }
};

ErrorOr<int> ladybird_main(Main::Arguments arguments) {
  // EngineManager gives each worker its own process group. Stop even wedged
  // WebContent descendants when our parent dies; never signal a caller's group.
  std::signal(SIGTERM, [](int) {
    if (getpgrp() == getpid()) kill(-getpgrp(), SIGKILL);
    _exit(143);
  });
  auto stateRoot = qEnvironmentVariable("DERP_FRAME_DIR");
  if (!QDir::isAbsolutePath(stateRoot))
    return Error::from_string_literal("DERP_FRAME_DIR must be absolute");
  QDir().mkpath(stateRoot + "/profile");
  qputenv("XDG_DATA_HOME", (stateRoot + "/profile/data").toUtf8());
  qputenv("XDG_CONFIG_HOME", (stateRoot + "/profile/config").toUtf8());
  qputenv("XDG_CACHE_HOME", (stateRoot + "/profile/cache").toUtf8());
  // QPainter font rendering needs Qt's GUI font database, but no native window.
  qputenv("QT_QPA_PLATFORM", "offscreen");
  int qtArgc = 1;
  char qtName[] = "derp-ladybird";
  char *qtArgv[] = {qtName, nullptr};
  QGuiApplication qtApplication(qtArgc, qtArgv);
  auto app = TRY(AdapterApplication::create(arguments));
  auto stderr_filter = ProtocolStderrFilter::create();
  auto theme = TRY(Gfx::load_system_theme(
      LexicalPath::join(WebView::s_ladybird_resource_root, "themes"sv,
                        "Default.ini"sv)
          .string()));
  std::map<QString, std::unique_ptr<Pane>> panes;
  int generation = 0;
  bool rendering = true;
  QByteArray input;
  std::vector<QJsonObject> pending;
  std::function<bool(QJsonObject const &)> handle = [&](QJsonObject const
                                                            &request) {
    auto method = request.value("method").toString();
    QJsonObject response{{"id", request.value("id")}};
    auto p = request.value("params").toObject();
    auto error = [&](QString code, QString message) {
      response["error"] = QJsonObject{{"code", code}, {"message", message}};
    };
    if (request["deadline"].toDouble() < QDateTime::currentMSecsSinceEpoch()) {
      auto it = panes.find(p["paneId"].toString());
      if (it != panes.end() && p["generation"].toInt() == generation) {
        auto key = QString::fromUtf8(QJsonDocument(QJsonArray{request["id"]})
                                         .toJson(QJsonDocument::Compact));
        if (it->second->queryKey == key)
          it->second->finish_query();
        if (it->second->inputKey == key)
          it->second->inputKey.clear();
        if (it->second->captureKey == key)
          it->second->captureKey.clear();
      }
      error("deadline", "Request deadline expired");
    } else if (method == "session.visibility") {
      rendering = p["visible"].toBool();
      for (auto& [id, pane] : panes) pane->setRendering(rendering);
      response["result"] = true;
    } else if (method == "engine.status")
      response["result"] = QJsonObject{
          {"engine", "ladybird"},
          {"available", true},
          {"engineVersion", "197c851802f23cf956800d8dfe5083e18a424490"},
          {"rendering", true},
          {"capabilities",
           QJsonArray{"frames", "resize", "capture", "input", "inspection",
                      "readiness", "popup-composition", "same-origin-frame-inspection"}}};
    else if (method == "session.open") {
      QSet<QString> ids;
      for (auto value : p["panes"].toArray()) {
        auto spec = value.toObject();
        auto id = spec["id"].toString();
        auto rawUrl = spec["url"].toString().toUtf8();
        if (id.isEmpty() || ids.contains(id) ||
            !URL::Parser::basic_parse(
                 StringView(rawUrl.constData(), rawUrl.size()))
                 .has_value()) {
          error("invalid_pane", "Pane needs a unique ID and valid URL");
          send_json(response);
          return true;
        }
        ids.insert(id);
        auto vp = value.toObject()["viewport"].toObject();
        auto scale = vp["deviceScaleFactor"].toDouble(1);
        if (!std::isfinite(scale) || scale <= 0 ||
            vp["width"].toInt(800) <= 0 || vp["height"].toInt(600) <= 0 ||
            !std::isfinite(vp["width"].toDouble(800) * scale) ||
            !std::isfinite(vp["height"].toDouble(600) * scale) ||
            std::round(vp["width"].toDouble(800) * scale) < 1 ||
            std::round(vp["height"].toDouble(600) * scale) < 1 ||
            std::round(vp["width"].toDouble(800) * scale) >
                std::numeric_limits<int>::max() ||
            std::round(vp["height"].toDouble(600) * scale) >
                std::numeric_limits<int>::max()) {
          error("viewport",
                "Unsupported viewport dimensions or deviceScaleFactor");
          send_json(response);
          return true;
        }
      }
      panes.clear();
      WebView::Application::cookie_jar().expire_cookies_accessed_since(
          UnixDateTime::from_seconds_since_epoch(0));
      WebView::Application::storage_jar().remove_items_accessed_since(
          UnixDateTime::from_seconds_since_epoch(0));
      generation = p["generation"].toInt();
      for (auto value : p["panes"].toArray()) {
        auto spec = value.toObject();
        auto vp = spec["viewport"].toObject();
        auto pane = std::make_unique<Pane>(theme, vp["width"].toInt(800),
                                           vp["height"].toInt(600),
                                           vp["deviceScaleFactor"].toDouble(1));
        auto *view = pane.get();
        view->id = spec["id"].toString();
        view->initialUrl = spec["url"].toString();
        view->generation = generation;

        view->dir = qEnvironmentVariable("DERP_FRAME_DIR") + "/" +
                    QUuid::createUuid().toString(QUuid::WithoutBraces);
        QDir().mkpath(view->dir);
        view->on_console_message = [view](WebView::ConsoleOutput output) {
          if (output.output.has<WebView::ConsoleLog>()) {
            auto const &log = output.output.get<WebView::ConsoleLog>();
            if (log.arguments.size() == 2 && log.arguments[0].is_string()
                && log.arguments[0].as_string() == "__DERPDESIGN_INSPECTION__"sv
                && log.arguments[1].is_string()) {
              auto const &text = log.arguments[1].as_string();
              view->accept_query_chunk(QString::fromUtf8(text.bytes_as_string_view().characters_without_null_termination(), int(text.bytes_as_string_view().length())));
              return;
            }
          }
          if (output.output.has<WebView::ConsoleError>()) {
            auto const &err = output.output.get<WebView::ConsoleError>();
            view->lastError = QString::fromUtf8(
                err.message.bytes_as_string_view()
                    .characters_without_null_termination(),
                int(err.message.bytes_as_string_view().length()));
            fprintf(stderr, "Ladybird pane %s: %s\n",
                    view->id.toUtf8().constData(),
                    view->lastError.toUtf8().constData());
          }
        };
        view->on_web_content_crashed = [view] {
          view->crashed = true;
          view->lastError = "WebContent process crashed";
        };
        view->on_load_start = [view](auto const &, bool) {
          view->popup.close();
          view->loaded = false;
          // Automatic crash-page navigation must not hide the failed renderer.
          if (!view->crashed)
            view->lastError.clear();
          view->pixels = {};
          ++view->navigationEpoch;
          view->finish_query();
        };
        view->on_ready_to_paint = [view] { view->paint(); };
        view->on_load_finish = [view](auto const &) { view->loaded = true; };
        auto url = ByteString(spec["url"].toString().toUtf8().constData());
        view->load(URL::Parser::basic_parse(url.view()).release_value());
        view->setRendering(rendering);
        panes[view->id] = std::move(pane);
      }
      response["result"] = QJsonObject{};
    } else if (method == "session.close") {
      if (p["generation"].toInt() == generation)
        panes.clear();
      response["result"] = QJsonObject{};
    } else if (p["generation"].toInt() != generation ||
               !panes.contains(p["paneId"].toString()))
      error("stale_generation", "Unknown pane or generation");
    else {
      auto &pane = *panes.at(p["paneId"].toString());
      if (method == "frame.ack") {
        if (p["sequence"].toInt() == pane.sequence) {
          QFile::remove(pane.path);
          pane.path.clear();
          pane.publish();
        }
        return true;
      }
      if (pane.crashed && (method == "pane.input" || method == "pane.resize")) {
        error("engine_crashed", pane.lastError);
        if (request.contains("id")) send_json(response);
        return true;
      }
      if (method == "pane.dismissPopup") {
        pane.popup.close();
        response["result"] = true;
      } else if (method == "pane.input") {
        auto key = QString::fromUtf8(QJsonDocument(QJsonArray{request["id"]})
                                         .toJson(QJsonDocument::Compact));
        if (pane.inputKey.isEmpty()) {
          auto event = p["event"].toObject();
          if (event["type"] == "key" || event["type"] == "text" || event["action"] == "down")
            pane.focus();
          auto message = pane.input(p["event"].toObject());
          if (!message.isEmpty()) {
            error("input", message);
            if (request.contains("id"))
              send_json(response);
            return true;
          }
          pane.inputKey = key;
        }
        if (pane.inputKey != key || !pane.input_idle())
          return false;
        pane.inputKey.clear();
        response["result"] = true;
      } else if (method == "pane.reset") {
        pane.crashed = false;
        pane.lastError.clear();
        pane.popup.close();
        pane.loaded = false;
        pane.pixels = {};
        auto url = ByteString(pane.initialUrl.toUtf8().constData());
        pane.load(URL::Parser::basic_parse(url.view()).release_value());
        response["result"] = true;
      } else if (method == "pane.resize") {
        auto vp = p["viewport"].toObject();
        auto scale = vp["deviceScaleFactor"].toDouble(pane.density);
        if (!std::isfinite(scale) || scale <= 0 || vp["width"].toInt() <= 0 ||
            vp["height"].toInt() <= 0 ||
            !std::isfinite(vp["width"].toDouble() * scale) ||
            !std::isfinite(vp["height"].toDouble() * scale) ||
            std::round(vp["width"].toDouble() * scale) < 1 ||
            std::round(vp["height"].toDouble() * scale) < 1 ||
            std::round(vp["width"].toDouble() * scale) >
                std::numeric_limits<int>::max() ||
            std::round(vp["height"].toDouble() * scale) >
                std::numeric_limits<int>::max()) {
          error("viewport",
                "Unsupported viewport dimensions or deviceScaleFactor");
          send_json(response);
          return true;
        }
        pane.resize(vp["width"].toInt(), vp["height"].toInt(),
                    vp["deviceScaleFactor"].toDouble(pane.density));
        response["result"] = QJsonObject{};
      } else if (method == "pane.ready" || method == "pane.capture" ||
                 method == "pane.inspect") {
        if (pane.crashed) {
          error("engine_crashed", pane.lastError);
          send_json(response);
          return true;
        }
        if ((!pane.loaded && method != "pane.inspect") ||
            pane.pixels.isNull() || !pane.input_idle())
          return false;
        auto options = p;
        options["mode"] = method == "pane.ready" ? "ready" : "inspect";
        auto key = QString::fromUtf8(QJsonDocument(QJsonArray{request["id"]})
                                         .toJson(QJsonDocument::Compact));
        auto result = pane.query(key, options);
        if (!result.has_value())
          return false;
        (*result)["selectPopup"] = pane.popup.snapshot();
        if (result->contains("error"))
          error("inspection", (*result)["error"].toString());
        else if (method != "pane.inspect" &&
                 (*result)["harnessError"].isString())
          error("harness", (*result)["harnessError"].toString());
        else if (method != "pane.inspect" && !(*result)["ready"].toBool()) {
          pane.finish_query();
          return false;
        } else if (method == "pane.ready" || method == "pane.inspect")
          response["result"] = *result;
        else {
          if (pane.captureKey != key) {
            pane.captureKey = key;
            pane.capturePaintRevision = pane.paintRevision;
            // Upstream's fixed debug action leaves line boxes disabled and
            // invalidates the traversable paint tree without touching DOM/CSS.
            pane.debug_request("set-line-box-borders", "off");
            return false;
          }
          if (pane.paintRevision <= pane.capturePaintRevision)
            return false;
          pane.captureKey.clear();
          QByteArray png;
          QBuffer buffer(&png);
          buffer.open(QIODevice::WriteOnly);
          pane.composed().save(&buffer, "PNG");
          response["result"] = QJsonObject{
              {"generation", generation},
              {"engineVersion", "197c851802f23cf956800d8dfe5083e18a424490"},
              {"pngBase64", QString::fromLatin1(png.toBase64())},
              {"inspection", *result}};
        }
        pane.finish_query();
      } else
        error("unsupported", "Unsupported operation: " + method);
    }
    if (request.contains("id"))
      send_json(response);
    return true;
  };
  RefPtr<Core::Timer> pending_timer;
  pending_timer = Core::Timer::create_repeating(5, [&] {
    auto requests = std::move(pending);
    pending.clear();
    for (auto const &request : requests)
      if (!handle(request)) {
        pending.push_back(request);
        if (!pending_timer->is_active())
          pending_timer->start();
      }
    if (pending.empty())
      pending_timer->stop();
  });
  auto notifier =
      Core::Notifier::construct(STDIN_FILENO, Core::Notifier::Type::Read);
  notifier->on_activation = [&] {
    char buffer[4096];
    auto count = read(STDIN_FILENO, buffer, sizeof(buffer));
    if (count <= 0) {
      Core::EventLoop::current().quit(count < 0 ? 1 : 0);
      return;
    }
    input.append(buffer, count);
    while (input.contains('\n')) {
      auto index = input.indexOf('\n');
      auto line = input.left(index);
      input.remove(0, index + 1);
      QJsonParseError parse;
      auto document = QJsonDocument::fromJson(line, &parse);
      if (parse.error != QJsonParseError::NoError || !document.isObject()) {
        send_json(
            {{"error", QJsonObject{{"code", "invalid_request"},
                                   {"message", "Invalid JSON request"}}}});
        continue;
      }
      auto request = document.object();
      if (!request.contains("deadline"))
        request["deadline"] = QDateTime::currentMSecsSinceEpoch() + 30000;
      if (!handle(request)) {
        pending.push_back(request);
        if (!pending_timer->is_active())
          pending_timer->start();
      }
    }
  };
  return app->execute();
}
