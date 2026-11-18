#pragma once
#include <QQuickItem>
#include "EngineManager.h"
class EngineSurface : public QQuickItem {
    Q_OBJECT
    Q_PROPERTY(QString paneId READ paneId WRITE setPaneId NOTIFY paneIdChanged)
    Q_PROPERTY(EngineManager* manager READ manager WRITE setManager NOTIFY managerChanged)
public:
    explicit EngineSurface(QQuickItem* parent = nullptr) : QQuickItem(parent) { setFlag(ItemHasContents); }
    QString paneId() const { return m_paneId; }
    void setPaneId(QString value) { if (m_paneId != value) { m_paneId = value; m_fullUpdate = true; emit paneIdChanged(); update(); } }
    EngineManager* manager() const { return m_manager; }
    void setManager(EngineManager* value);
    QSGNode* updatePaintNode(QSGNode*, UpdatePaintNodeData*) override;
signals:
    void paneIdChanged();
    void managerChanged();
private:
    bool m_fullUpdate = true;
    QRect m_damage;
    QString m_paneId;
    EngineManager* m_manager = nullptr;
};
