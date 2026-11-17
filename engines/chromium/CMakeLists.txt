cmake_minimum_required(VERSION 3.21)
project(derp_cef LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
list(APPEND CMAKE_MODULE_PATH "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
find_package(Qt6 REQUIRED COMPONENTS Core Gui)
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)
add_executable(derp-chromium main.cpp)
target_include_directories(derp-chromium PRIVATE ${CEF_ROOT})
target_link_libraries(derp-chromium PRIVATE libcef_dll_wrapper "${CEF_ROOT}/Release/libcef.so" Qt6::Core Qt6::Gui)
set_target_properties(derp-chromium PROPERTIES BUILD_RPATH "$ORIGIN")
add_custom_command(TARGET derp-chromium POST_BUILD
 COMMAND ${CMAKE_COMMAND} -E copy_directory "${CEF_ROOT}/Release" "$<TARGET_FILE_DIR:derp-chromium>"
 COMMAND ${CMAKE_COMMAND} -E copy_directory "${CEF_ROOT}/Resources" "$<TARGET_FILE_DIR:derp-chromium>")
