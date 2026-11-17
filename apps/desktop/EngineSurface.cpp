#include "EngineSurface.h"
#include <QQuickWindow>
#include <QSGSimpleTextureNode>
void EngineSurface::setManager(EngineManager* value) {
    if (m_manager == value) return;
    if (m_manager) disconnect(m_manager, nullptr, this, nullptr);
    m_manager = value;
    if (value) {
        connect(value, &EngineManager::frameChanged, this, [this](const QString& id) { if (id == m_paneId && m_manager->renderingVisible()) update(); });
        connect(value, &EngineManager::sessionChanged, this, [this] { update(); });
    }
    emit managerChanged(); update();
}
class FrameNode : public QSGSimpleTextureNode { public: qint64 frameKey=0; };
QSGNode* EngineSurface::updatePaintNode(QSGNode* oldNode, UpdatePaintNodeData*) {
    auto* node=static_cast<FrameNode*>(oldNode);
    const auto image=m_manager?m_manager->frame(m_paneId):QImage{};
    if(image.isNull() || !window()){delete node;return nullptr;}
    if(!node)node=new FrameNode;
    if(node->frameKey!=image.cacheKey()){
        node->setTexture(window()->createTextureFromImage(image));
        node->setOwnsTexture(true);
        node->frameKey=image.cacheKey();
    }
    node->setFiltering(QSGTexture::Linear);
    node->setRect(boundingRect());
    return node;
}
