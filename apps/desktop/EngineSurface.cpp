#include "EngineSurface.h"
#include <QQuickWindow>
#include <QSGSimpleTextureNode>
#include <rhi/qrhi.h>
#include <memory>

void EngineSurface::setManager(EngineManager* value) {
    if (m_manager == value) return;
    if (m_manager) disconnect(m_manager, nullptr, this, nullptr);
    m_manager = value;
    m_fullUpdate = true;
    if (value) {
        connect(value, &EngineManager::frameUpdated, this, [this](const QString& id, QRect rect) {
            if (id == m_paneId) m_damage |= rect;
        });
        connect(value, &EngineManager::frameChanged, this, [this](const QString& id) {
            if (id == m_paneId && m_manager->renderingVisible()) update();
        });
        connect(value, &EngineManager::sessionChanged, this, [this] { m_fullUpdate = true; update(); });
    }
    emit managerChanged(); update();
}

// A culled node can synchronize several times before Qt submits its texture.
// Keep all outstanding damage until commit, taking pixels from the newest frame.
class PaneTexture final : public QSGTexture {
public:
    explicit PaneTexture(QRhiTexture *texture) : texture(texture) {}
    QRhiTexture *rhiTexture() const override { return texture.get(); }
    QSize textureSize() const override { return texture->pixelSize(); }
    qint64 comparisonKey() const override { return qint64(quintptr(texture.get())); }
    bool hasAlphaChannel() const override { return true; }
    bool hasMipmaps() const override { return false; }

    qsizetype stage(const QImage &frame, QRect change) {
        pending |= change;
        pixels = frame;
        return qsizetype(pending.width()) * pending.height() * 4;
    }
    void commitTextureOperations(QRhi *, QRhiResourceUpdateBatch *batch) override {
        if (pixels.isNull()) return;
        QRhiTextureSubresourceUploadDescription upload(pixels);
        upload.setSourceTopLeft(pending.topLeft());
        upload.setSourceSize(pending.size());
        upload.setDestinationTopLeft(pending.topLeft());
        batch->uploadTexture(texture.get(), QRhiTextureUploadDescription(QRhiTextureUploadEntry(0, 0, upload)));
        pixels = {};
        pending = {};
    }
private:
    std::unique_ptr<QRhiTexture> texture;
    QRect pending;
    QImage pixels;
};

class FrameNode : public QSGSimpleTextureNode {
public:
    qint64 frameKey = 0;
    PaneTexture *persistent = nullptr; // Owned by QSGSimpleTextureNode.
};

QSGNode* EngineSurface::updatePaintNode(QSGNode* oldNode, UpdatePaintNodeData*) {
    auto *node = static_cast<FrameNode*>(oldNode);
    const auto image = m_manager ? m_manager->frame(m_paneId) : QImage{};
    if (image.isNull() || !window()) { delete node; return nullptr; }
    if (!node) { node = new FrameNode; m_fullUpdate = true; }
    if (m_fullUpdate || node->frameKey != image.cacheKey()) {
        const auto started = m_manager->now();
        auto *rhi = window()->rhi();
        QRect damage = m_fullUpdate || m_damage.isEmpty() ? image.rect() : m_damage.intersected(image.rect());
        // On OpenGL, replacing the texture beats an in-place upload for the
        // large scrolling repaints in the gallery. Keep small updates in place.
        const bool replace = rhi && rhi->backend() == QRhi::OpenGLES2 &&
            qint64(damage.width()) * damage.height() * 2 >= qint64(image.width()) * image.height();
        if (replace) node->persistent = nullptr;
        if (!replace && rhi && rhi->isTextureFormatSupported(QRhiTexture::BGRA8) &&
            (!node->persistent || node->persistent->textureSize() != image.size())) {
            auto texture = std::unique_ptr<QRhiTexture>(rhi->newTexture(QRhiTexture::BGRA8, image.size()));
            if (texture->create()) {
                node->persistent = new PaneTexture(texture.release());
                node->setTexture(node->persistent);
                node->setOwnsTexture(true);
                m_manager->metric(m_paneId, "textureAllocations");
                damage = image.rect();
            } else {
                node->persistent = nullptr;
            }
        }
        qsizetype bytes = image.sizeInBytes();
        if (node->persistent) {
            bytes = node->persistent->stage(image, damage);
            node->markDirty(QSGNode::DirtyMaterial);
        } else {
            node->setTexture(window()->createTextureFromImage(image));
            node->setOwnsTexture(true);
            m_manager->metric(m_paneId, "textureAllocations");
        }
        node->frameKey = image.cacheKey();
        m_fullUpdate = false;
        m_damage = {};
        m_manager->metric(m_paneId, "textureStageBytes", bytes);
        m_manager->metric(m_paneId, "fullTextureBytes", image.sizeInBytes());
        m_manager->metric(m_paneId, "textureStageMs", m_manager->now() - started);
    }
    node->setFiltering(QSGTexture::Linear);
    node->setRect(boundingRect());
    return node;
}
