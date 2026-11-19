#pragma once
#include <LibWebCommon/HTML/SelectItem.h>
#include <QDateTime>
#include <QFontMetricsF>
#include <QJsonArray>
#include <QJsonObject>
#include <QPainter>
#include <algorithm>
#include <functional>
#include <optional>

// The upstream UI normally presents these items in a native QMenu. Our surface
// is offscreen, so render and hit-test the same option IDs in pane coordinates.
class SelectPopup {
public:
  struct Row {
    QString label;
    std::optional<u32> id;
    bool disabled = false, selected = false, group = false, separator = false;
  };
  bool visible = false;
  QRectF bounds;
  std::vector<Row> rows;
  int active = -1, pressed = -1, offset = 0, visibleRows = 0;
  static constexpr int rowHeight = 26;
  QString search;
  qint64 searchTime = 0;
  std::function<void(std::optional<u32>)> closed;
  static QString text(Utf16String const &value) {
    auto string = value.to_well_formed_utf8();
    auto bytes = string.bytes_as_string_view();
    return QString::fromUtf8(bytes.characters_without_null_termination(),
                             int(bytes.length()));
  }
  bool selectable(int index) const {
    return index >= 0 && index < int(rows.size()) &&
           rows[index].id.has_value() && !rows[index].disabled;
  }
  QFont font() const {
    QFont f("sans-serif");
    f.setPixelSize(14);
    return f;
  }
  void show(Gfx::IntPoint position, int minimumWidth,
            Vector<Web::HTML::SelectItem> const &items, double density,
            int width, int height) {
    rows.clear();
    active = -1;
    pressed = -1;
    offset = 0;
    search.clear();
    auto option = [&](auto const &item, bool grouped) {
      rows.push_back({(grouped ? "    " : "") + text(item.label), item.id,
                      item.disabled, item.selected});
      if (item.selected)
        active = int(rows.size()) - 1;
    };
    for (auto const &item : items) {
      if (item.has<Web::HTML::SelectItemOption>())
        option(item.get<Web::HTML::SelectItemOption>(), false);
      else if (item.has<Web::HTML::SelectItemOptionGroup>()) {
        auto const &group = item.get<Web::HTML::SelectItemOptionGroup>();
        rows.push_back({text(group.label), {}, true, false, true});
        for (auto const &entry : group.items)
          option(entry, true);
      } else
        rows.push_back({"", {}, true, false, false, true});
    }
    const double viewportWidth = width / density,
                 viewportHeight = height / density;
    QFontMetricsF metrics(font());
    // WebContentClient already converts minimum width to logical pixels.
    double menuWidth = minimumWidth;
    for (auto const &row : rows)
      menuWidth =
          std::max(menuWidth, metrics.horizontalAdvance(row.label) + 40);
    menuWidth = std::min(menuWidth, std::max(1.0, viewportWidth - 4));
    visibleRows = std::min(int(rows.size()),
                           std::max(1, int((viewportHeight - 4) / rowHeight)));
    const double menuHeight =
        std::min(double(visibleRows * rowHeight + 2), viewportHeight);
    double x = std::clamp(position.x() / density, 0.0,
                          std::max(0.0, viewportWidth - menuWidth));
    double y = position.y() / density;
    if (y + menuHeight > viewportHeight)
      y = std::max(0.0, y - menuHeight - rowHeight);
    y = std::clamp(y, 0.0, std::max(0.0, viewportHeight - menuHeight));
    bounds = {x, y, menuWidth, menuHeight};
    visible = true;
    reveal();
  }
  void reveal() {
    if (active < offset)
      offset = std::max(0, active);
    if (active >= offset + visibleRows)
      offset = active - visibleRows + 1;
  }
  void close(std::optional<u32> choice = {}) {
    if (!visible)
      return;
    visible = false;
    pressed = -1;
    if (closed)
      closed(choice);
  }
  int at(QPointF p) const {
    if (!bounds.contains(p))
      return -1;
    int i = offset + int((p.y() - bounds.y() - 1) / rowHeight);
    return i < int(rows.size()) ? i : -1;
  }
  bool input(QJsonObject const &event) {
    if (!visible)
      return false;
    auto type = event["type"].toString(), action = event["action"].toString();
    if (type == "pointer") {
      auto p = QPointF(event["x"].toDouble(), event["y"].toDouble());
      int index = at(p);
      if (action == "down") {
        if (!bounds.contains(p)) {
          close();
          return true;
        }
        pressed = selectable(index) && event["button"] == "left" ? index : -1;
      }
      if (action == "move" && selectable(index))
        active = index;
      if (action == "up") {
        if (pressed >= 0 && pressed == index && selectable(index))
          close(rows[index].id);
        pressed = -1;
      }
    } else if (type == "wheel") {
      int direction = event["deltaY"].toDouble() > 0 ? -1 : 1;
      offset = std::clamp(offset + direction * 3, 0,
                          std::max(0, int(rows.size()) - visibleRows));
    } else if (type == "key" && action == "down") {
      auto key = event["key"].toString();
      if (key == "Escape" || key == "Tab") {
        close();
        return key != "Tab";
      }
      if (key == "Enter" || key == " " || key == "Space") {
        if (selectable(active))
          close(rows[active].id);
      } else if (key == "ArrowDown" || key == "ArrowUp" || key == "Home" ||
                 key == "End" || key == "PageDown" || key == "PageUp") {
        const int direction =
            (key == "ArrowUp" || key == "End" || key == "PageUp") ? -1 : 1;
        int index = active;
        if (key == "Home")
          index = -1;
        else if (key == "End")
          index = int(rows.size());
        else if (key == "PageDown" || key == "PageUp")
          index = std::clamp(active + direction * (visibleRows - 1), -1,
                             int(rows.size()));
        for (index += direction; index >= 0 && index < int(rows.size());
             index += direction)
          if (selectable(index)) {
            active = index;
            break;
          }
        reveal();
      }
    } else if (type == "text") {
      if (event["text"] == " " && search.isEmpty()) {
        if (selectable(active))
          close(rows[active].id);
        return true;
      }
      auto now = QDateTime::currentMSecsSinceEpoch();
      if (now - searchTime > 1000)
        search.clear();
      searchTime = now;
      search += event["text"].toString();
      for (int n = 1; n <= int(rows.size()); ++n) {
        int index = (std::max(-1, active) + n) % int(rows.size());
        if (selectable(index) && rows[index].label.trimmed().startsWith(
                                     search, Qt::CaseInsensitive)) {
          active = index;
          reveal();
          break;
        }
      }
    }
    return true;
  }
  void draw(QImage &image, double density) const {
    if (!visible)
      return;
    QPainter painter(&image);
    painter.scale(density, density);
    painter.setClipRect(bounds);
    painter.fillRect(bounds, QColor("#f8f8f8"));
    painter.setPen(QColor("#555555"));
    painter.drawRect(bounds.adjusted(.5, .5, -.5, -.5));
    painter.setFont(font());
    for (int index = offset;
         index < std::min(int(rows.size()), offset + visibleRows); ++index) {
      auto const &row = rows[index];
      QRectF rect(bounds.x() + 1, bounds.y() + 1 + (index - offset) * rowHeight,
                  bounds.width() - 2, rowHeight);
      if (row.separator) {
        painter.setPen(QColor("#cccccc"));
        painter.drawLine(rect.left() + 8, rect.center().y(), rect.right() - 8,
                         rect.center().y());
        continue;
      }
      bool highlighted = index == active && selectable(index);
      if (highlighted)
        painter.fillRect(rect, QColor("#2d65b0"));
      painter.setPen(row.disabled ? QColor("#777777")
                                  : (highlighted ? Qt::white : Qt::black));
      auto f = font();
      f.setBold(row.group);
      painter.setFont(f);
      painter.drawText(rect.adjusted(25, 0, -6, 0),
                       Qt::AlignVCenter | Qt::AlignLeft,
                       QFontMetricsF(f).elidedText(row.label, Qt::ElideRight,
                                                   rect.width() - 31));
      if (row.selected)
        painter.drawText(rect.adjusted(6, 0, 0, 0),
                         Qt::AlignVCenter | Qt::AlignLeft,
                         QString::fromUtf8("✓"));
    }
    painter.setPen(QColor("#555555"));
    if (offset > 0)
      painter.drawText(bounds.adjusted(0, 0, -4, 0),
                       Qt::AlignTop | Qt::AlignRight, QString::fromUtf8("▴"));
    if (offset + visibleRows < int(rows.size()))
      painter.drawText(bounds.adjusted(0, 0, -4, 0),
                       Qt::AlignBottom | Qt::AlignRight,
                       QString::fromUtf8("▾"));
  }
  QJsonObject snapshot() const {
    QJsonArray entries;
    for (int i = 0; i < int(rows.size()); ++i) {
      auto const &row = rows[i];
      entries.append(QJsonObject{{"label", row.label},
                                 {"disabled", row.disabled},
                                 {"selected", row.selected},
                                 {"group", row.group},
                                 {"separator", row.separator},
                                 {"highlighted", i == active}});
    }
    return {{"visible", visible},
            {"bounds", QJsonObject{{"x", bounds.x()},
                                   {"y", bounds.y()},
                                   {"width", bounds.width()},
                                   {"height", bounds.height()}}},
            {"rowHeight", rowHeight},
            {"scrollOffset", offset},
            {"items", entries}};
  }
};
