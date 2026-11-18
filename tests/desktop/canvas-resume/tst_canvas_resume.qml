import QtQuick
import QtTest
import "../../../apps/desktop/qml"

Item {
    Main { id: app }
    TestCase {
        name: "CanvasResume"
        parent: app.contentItem
        when: windowShown

        function waitForDemo() {
            tryCompare(app, "selectionContext", ["project","first",workspace.state.selection.generation].join(":"), 10000)
            tryVerify(()=>app.activeDemo.panes.length === 1)
            wait(100)
        }
        function test_save() {
            tryVerify(()=>app.selection.demoId === "first", 15000)
            waitForDemo()
            app.zoomAround(1.75)
            app.panX = -237
            app.panY = 91
            tryVerify(()=>workspace.savedCanvas().panX === -237)
        }
        function test_resume() {
            tryVerify(()=>app.selection.demoId === "first", 15000)
            waitForDemo()
            compare(app.zoom, 1.75)
            compare(app.panX, -237)
            compare(app.panY, 91)
            compare(app.overview, false)
            verify(nativeInput.saveWindow(app.contentItem, workspace.state.projects[0].sourceRoot + "/restored.png"))
        }
        function test_switch() {
            test_resume()
            const oldGeneration = app.selection.generation
            verify(nativeInput.saveWindow(app.contentItem, workspace.state.projects[0].sourceRoot + "/switch-ready.png"))
            tryVerify(()=>app.selection.generation > oldGeneration && app.selection.demoId === "first", 15000)
            tryCompare(app, "overview", true)
            tryVerify(()=>app.zoom !== 1.75)
        }
        function test_override() {
            tryVerify(()=>app.selection.demoId === "second", 15000)
            compare(app.selection.resumedFrom, undefined)
            tryCompare(app, "overview", true)
        }
    }
}
