cmake_minimum_required(VERSION 3.24)
project(BurlHello VERSION 0.1.0 LANGUAGES C CXX)

find_package(Pulp REQUIRED CONFIG)

burl_add_app(BurlHello
    SOURCES main.cpp
    APP_NAME "Burl Hello"
    BUNDLE_ID "org.burl.hello"
    VERSION "${PROJECT_VERSION}"
)
