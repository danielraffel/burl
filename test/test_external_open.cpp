#include <catch2/catch_test_macros.hpp>
#include <pulp/platform/external_open.hpp>

using pulp::platform::ExternalOpen;

namespace {
struct BackendReset {
    ~BackendReset() { ExternalOpen::clear_backend(); }
};
}

TEST_CASE("ExternalOpen routes exact paths through the selected host operation") {
    BackendReset reset;
    std::string opened;
    std::string revealed;
    ExternalOpen::set_backend({
        .open = [&](const std::string& path) { opened = path; return true; },
        .reveal = [&](const std::string& path) { revealed = path; return true; },
    });

    REQUIRE(ExternalOpen::open("/tmp/project"));
    REQUIRE(opened == "/tmp/project");
    REQUIRE(revealed.empty());
    REQUIRE(ExternalOpen::reveal("/tmp/project/file.txt"));
    REQUIRE(revealed == "/tmp/project/file.txt");
}

TEST_CASE("ExternalOpen rejects empty paths before reaching a backend") {
    BackendReset reset;
    int calls = 0;
    ExternalOpen::set_backend({
        .open = [&](const std::string&) { ++calls; return true; },
        .reveal = [&](const std::string&) { ++calls; return true; },
    });

    REQUIRE_FALSE(ExternalOpen::open(""));
    REQUIRE_FALSE(ExternalOpen::reveal(""));
    REQUIRE(calls == 0);
}

TEST_CASE("ExternalOpen fails closed when a host omits an operation") {
    BackendReset reset;
    ExternalOpen::set_backend({.open = [](const std::string&) { return true; }});
    REQUIRE(ExternalOpen::open("/tmp/project"));
    REQUIRE_FALSE(ExternalOpen::reveal("/tmp/project"));
}
