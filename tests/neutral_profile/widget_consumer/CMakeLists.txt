cmake_minimum_required(VERSION 3.24)
project(BurlNeutralWidgetConsumer LANGUAGES CXX)

find_package(Pulp CONFIG REQUIRED)
if(BURL_BUILD_AUDIO)
    message(FATAL_ERROR "expected an audio-free Burl SDK")
endif()

add_executable(neutral-widget-consumer main.cpp)
target_link_libraries(neutral-widget-consumer PRIVATE Pulp::view)
target_compile_features(neutral-widget-consumer PRIVATE cxx_std_20)
