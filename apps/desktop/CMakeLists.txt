cmake_minimum_required(VERSION 3.25)
project(DerpDesign VERSION 0.1 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_AUTOMOC ON)
find_package(Qt6 REQUIRED COMPONENTS Core Gui Quick QuickControls2 Network WebSockets)
qt_standard_project_setup(REQUIRES 6.8)
qt_add_executable(derpdesign main.cpp WorkspaceClient.cpp WorkspaceClient.h EngineManager.cpp EngineManager.h EngineSurface.cpp EngineSurface.h)
qt_add_qml_module(derpdesign URI DerpDesign VERSION 1.0 QML_FILES qml/Main.qml qml/PaneView.qml qml/Inspector.qml qml/ActionButton.qml qml/ToolTile.qml)
target_link_libraries(derpdesign PRIVATE Qt6::Core Qt6::Gui Qt6::Quick Qt6::QuickControls2 Qt6::Network Qt6::WebSockets)

include(CTest)
if(BUILD_TESTING)
    find_package(Qt6 REQUIRED COMPONENTS Test QuickTest)
    qt_add_executable(desktop-visibility-tests ../../tests/desktop/visibility.cpp EngineManager.cpp EngineManager.h EngineSurface.cpp EngineSurface.h)
    target_include_directories(desktop-visibility-tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(desktop-visibility-tests PRIVATE Qt6::Test Qt6::Quick Qt6::Network)
    qt_add_executable(desktop-native-tests ../../tests/desktop/native.cpp WorkspaceClient.cpp WorkspaceClient.h EngineManager.cpp EngineManager.h EngineSurface.cpp EngineSurface.h)
    target_include_directories(desktop-native-tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(desktop-native-tests PRIVATE Qt6::QuickTest Qt6::Test Qt6::Quick Qt6::Network Qt6::WebSockets)
    target_compile_definitions(desktop-native-tests PRIVATE QUICK_TEST_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../../tests/desktop")
    # Live suites in nested directories need their workspace/MCP runners.
    add_test(NAME desktop-native COMMAND desktop-native-tests
        -input "${CMAKE_CURRENT_SOURCE_DIR}/../../tests/desktop/tst_native.qml")
    add_test(NAME desktop-navigation COMMAND desktop-native-tests
        -input "${CMAKE_CURRENT_SOURCE_DIR}/../../tests/desktop/navigation")
    add_test(NAME desktop-inspector COMMAND desktop-native-tests
        -input "${CMAKE_CURRENT_SOURCE_DIR}/../../tests/desktop/inspector")
    set_tests_properties(desktop-inspector PROPERTIES
        ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;QT_SCALE_FACTOR=1.6")
    set_tests_properties(desktop-navigation PROPERTIES
        ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;QT_SCALE_FACTOR=1.6")
    set_tests_properties(desktop-native PROPERTIES
        ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software")
endif()
