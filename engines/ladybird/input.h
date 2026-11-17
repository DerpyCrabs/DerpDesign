#pragma once

#include <LibWeb/Page/InputEvent.h>
#include <LibWebView/ViewImplementation.h>
#include <QJsonArray>
#include <QJsonObject>
#include <cmath>

inline QString send_input(WebView::ViewImplementation &view,
                          QJsonObject const &event,
                          Web::UIEvents::MouseButton &buttons,
                          double scale = 1) {
  using namespace Web::UIEvents;
  if (!std::isfinite(scale) || scale <= 0)
    return "Invalid input scale";
  auto modifiers = Mod_None;
  for (auto const &value : event["modifiers"].toArray()) {
    auto modifier = value.toString();
    if (modifier == "shift")
      modifiers |= Mod_Shift;
    else if (modifier == "control")
      modifiers |= Mod_Ctrl;
    else if (modifier == "alt")
      modifiers |= Mod_Alt;
    else if (modifier == "meta")
      modifiers |= Mod_Super;
    else
      return "Unsupported modifier: " + modifier;
  }
  auto type = event["type"].toString();
  auto action = event["action"].toString();
  if (type == "pointer" || type == "wheel") {
    Web::DevicePixelPoint position{event["x"].toDouble() * scale,
                                   event["y"].toDouble() * scale};
    auto mouse_type = Web::MouseEvent::Type::MouseMove;
    auto button = MouseButton::None;
    int dx = 0, dy = 0;
    if (type == "wheel") {
      mouse_type = Web::MouseEvent::Type::MouseWheel;
      // Protocol carries Qt angleDelta (positive Y means up). Match Qt's
      // angle-wheel fallback, including its horizontal direction.
      bool valid = false;
      auto lines =
          qEnvironmentVariable("DERP_WHEEL_SCROLL_LINES", "3").toInt(&valid);
      auto factor = (valid && lines > 0 ? lines : 3) * 24.0 * scale / 120.0;
      dx = static_cast<int>(event["deltaX"].toDouble() * factor);
      dy = static_cast<int>(-event["deltaY"].toDouble() * factor);
    } else if (action == "down" || action == "up") {
      auto name = event["button"].toString();
      if (name == "left")
        button = MouseButton::Primary;
      else if (name == "right")
        button = MouseButton::Secondary;
      else if (name == "middle")
        button = MouseButton::Middle;
      else
        return "Unsupported pointer button: " + name;
      mouse_type = action == "down" ? Web::MouseEvent::Type::MouseDown
                                    : Web::MouseEvent::Type::MouseUp;
      if (action == "down")
        buttons |= button;
      else
        buttons &= ~button;
    } else if (action == "leave") {
      mouse_type = Web::MouseEvent::Type::MouseLeave;
    } else if (action != "move") {
      return "Unsupported pointer action: " + action;
    }
    view.enqueue_input_event(Web::MouseEvent{mouse_type, position, position,
                                             button, buttons, modifiers, dx, dy,
                                             nullptr});
    return {};
  }
  auto enqueue_key = [&](Web::KeyEvent::Type kind, KeyCode key, u32 point,
                         bool repeat = false) {
    view.enqueue_input_event(
        Web::KeyEvent{kind, key, modifiers, point, repeat, nullptr});
  };
  if (type == "text") {
    if (!event["text"].isString())
      return "Missing input text";
    for (auto point : event["text"].toString().toUcs4()) {
      auto key = code_point_to_key_code(point);
      enqueue_key(Web::KeyEvent::Type::KeyDown, key, point);
      enqueue_key(Web::KeyEvent::Type::KeyUp, key, point);
    }
    return {};
  }
  if (type != "key")
    return "Unsupported input type: " + type;
  if (action != "down" && action != "up")
    return "Unsupported key action: " + action;
  auto name = event["key"].toString();
  if (name == "Enter")
    name = "Return";
  else if (name.startsWith("Arrow"))
    name = name.mid(5);
  else if (name == "Shift")
    name = "LeftShift";
  else if (name == "Control")
    name = "LeftControl";
  else if (name == "Alt")
    name = "LeftAlt";
  else if (name == "Meta")
    name = "LeftSuper";
  KeyCode key = Key_Invalid;
  u32 point = 0;
  auto points = name.toUcs4();
  if (points.size() == 1) {
    point = points[0];
    key = code_point_to_key_code(point);
  } else {
#define __ENUMERATE_KEY_CODE(identifier, ui_name, code)                        \
  if (name == QLatin1String(ui_name))                                          \
    key = Key_##identifier;
    ENUMERATE_KEY_CODES
#undef __ENUMERATE_KEY_CODE
  }
  if (key == Key_Invalid && points.size() != 1)
    return "Unsupported key: " + name;
  if (key == Key_Return)
    point = '\n';
  if (key == Key_Tab)
    point = '\t';
  enqueue_key(action == "down" ? Web::KeyEvent::Type::KeyDown
                               : Web::KeyEvent::Type::KeyUp,
              key, point, event["repeat"].toBool());
  return {};
}
