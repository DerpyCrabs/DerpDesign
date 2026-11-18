import QtQuick
import QtTest
import "../../../apps/desktop/qml"

Item {
    Main { id: app }
    property var inspected: null
    Connections {
        target: workspace
        function onOperationCompleted(method, result) {
            if (method === "pane.inspect") inspected = result.element
        }
    }
    TestCase {
        name: "CanvasGPU"
        when: windowShown
        parent: app.contentItem

        function report(phase, sample, events) {
            const deadline = 1000 / sample.refreshHz
            let gaps = []
            let missed = 0
            let previous = 0
            for (const time of [...sample.timestamps, sample.durationMs]) {
                const gap = time - previous
                gaps.push(gap)
                missed += Math.max(0, Math.round(gap / deadline) - 1)
                previous = time
            }
            gaps.sort((a,b) => a-b)
            const p95 = gaps[Math.ceil(gaps.length * 0.95)-1]
            const fps = sample.timestamps.length * 1000 / sample.durationMs
            console.log("GPU_PHASE", JSON.stringify({phase, events, device:sample.device,
                gpuMsPerFrame:sample.gpuSamples ? sample.gpuFrameMs/sample.gpuSamples : null,
                engine:sample.engine, hostCpuMs:sample.hostCpuMs, refreshHz:sample.refreshHz, scale:sample.scale, width:app.width, height:app.height,
                durationMs:sample.durationMs, frames:sample.timestamps.length, fps, p95Ms:p95,
                worstMs:gaps[gaps.length-1], missedRefreshes:missed}))
            verify(sample.device.hardware === true, "Hardware scene graph required")
        }

        function visual(node, name) {
            if (node.objectName === name) return node
            for (const child of node.children || []) {
                const found = visual(child, name)
                if (found) return found
            }
            return null
        }

        function gesture(phase, zooming, updateButton) {
            const target = app.contentItem
            const pane = visual(target, "pane-" + app.activeDemo.panes[0].id)
            verify(!!pane, "Missing first pane")
            const surface = visual(pane, "paneInteraction")
            const point = surface.mapToItem(target, surface.width/2, surface.height/2)
            const x = Math.round(point.x)
            const y = Math.round(point.y)
            const initial = zooming ? app.zoom : app.panX
            let changed = false
            if (!zooming) nativeInput.dragEvent(target, "press", x, y)
            nativeInput.beginFrames(target)
            const start = Date.now()
            let events = 0
            while (Date.now() - start < 2500) {
                if (updateButton && events % 20 === 0) {
                    for (const action of ["down","up"])
                        workspace.call("pane.input", {paneId:"gallery-arrivals", event:{type:"pointer",
                            action, button:"left", x:updateButton.x + updateButton.width/2,
                            y:updateButton.y + updateButton.height/2}})
                }
                const step = events % 32
                if (zooming)
                    mouseWheel(target, x, y, 0, step < 16 ? 120 : -120, Qt.NoButton, Qt.ControlModifier)
                else
                    nativeInput.dragEvent(target, "move", x + (step < 16 ? step : 32-step)*5, y)
                changed = changed || Math.abs((zooming ? app.zoom : app.panX) - initial) > 0.001
                events++
                wait(5)
            }
            const sample = nativeInput.endFrames(target)
            if (!zooming) nativeInput.dragEvent(target, "release", x, y)
            verify(changed, phase + " input did not change the canvas")
            report(phase, sample, events)
            if (updateButton) verify(sample.engine.nativeInputSent >= 10 && sample.engine.framesReceived >= 5,
                                     "Expected active browser input and new engine frames during drag")
        }

        function inspect(id, selector) {
            inspected = null
            workspace.call("pane.inspect", {paneId:id, selector})
            tryVerify(()=>!!inspected, 5000, selector + ": " + workspace.error)
            return inspected
        }

        function contentInput() {
            const gallery = app.activeDemo.id === "televecha-message-gallery"
            const id = gallery ? "gallery-arrivals" : app.activeDemo.panes[0].id
            app.focusPane(id)
            app.fitPane()
            wait(100)
            const button = inspect(id, gallery ? "#receive-update:not([hidden])" : "[aria-label=Menu]")
            const surface = visual(visual(app.contentItem, "pane-" + id), "paneInteraction")
            const x = button.bounds.x + button.bounds.width/2
            const y = button.bounds.y + button.bounds.height/2
            if (!gallery) compare(nativeInput.renderedPixel(surface, 18, 68), "#172235")
            nativeInput.beginFrames(app.contentItem)
            for (let i = 0; i < 9; i++) {
                nativeInput.dragEvent(surface, "press", x, y)
                nativeInput.dragEvent(surface, "release", x, y)
                wait(80)
            }
            if (gallery) {
                const last = inspect(id, ".conversation-ready")
                verify(/Tracking acquired|Signal confirmed|The upper stage is in view/.test(last.text), last.text)
            } else {
                inspect(id, "[aria-expanded=true]")
            }
            const sample = nativeInput.endFrames(app.contentItem)
            if (!gallery) {
                tryVerify(()=>nativeInput.renderedPixel(surface, 18, 68) === "#33445c",
                          3000, "Menu state reached DOM but popup pixels never reached the window")
                verify(sample.engine.textureStageBytes < sample.engine.fullTextureBytes)
                verify(sample.engine.textureAllocations <= 1, "Small repaints repeatedly allocated textures")
            }
            console.log("GPU_PHASE", JSON.stringify({phase:"content clicks", events:9,
                frames:sample.timestamps.length, durationMs:sample.durationMs,
                hostCpuMs:sample.hostCpuMs, engine:sample.engine}))
            verify(sample.engine.nativeInputSent >= 18 && sample.engine.framesReceived > 0)
        }

        function test_gallery() {
            tryVerify(()=>nativeInput.benchmarkReady(), 100000)
            for (const pane of app.activeDemo.panes)
                tryVerify(()=>engines.frameSize(pane.id).width > 0, 10000, pane.id)
            nativeInput.beginFrames(app.contentItem)
            wait(2000)
            const idle = nativeInput.endFrames(app.contentItem)
            console.log("GPU_PHASE", JSON.stringify({phase:"idle", durationMs:idle.durationMs,
                frames:idle.timestamps.length, engine:idle.engine, hostCpuMs:idle.hostCpuMs}))
            app.chooseTool("hand")
            app.fitAll()
            wait(250)
            gesture("overview drag", false)
            app.fitAll()
            gesture("wheel zoom", true)
            app.focusPane(app.activeDemo.panes[0].id)
            app.actualSize()
            app.chooseTool("hand")
            gesture("actual size drag", false)
            contentInput()
            if (app.activeDemo.id === "televecha-message-gallery") {
                const bounds = inspect("gallery-arrivals", "#receive-update").bounds
                app.fitAll()
                app.chooseTool("hand")
                gesture("drag during message arrivals", false, bounds)
            }
        }
    }
}
