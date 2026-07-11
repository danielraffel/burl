cmake_minimum_required(VERSION 3.24)

if(DEFINED ENV{TMPDIR} AND NOT "$ENV{TMPDIR}" STREQUAL "")
    set(_test_base "$ENV{TMPDIR}")
else()
    set(_test_base "/tmp")
endif()
set(_test_root "${_test_base}/burl-add-app-contract")
file(REMOVE_RECURSE "${_test_root}")
file(MAKE_DIRECTORY "${_test_root}")
file(WRITE "${_test_root}/main.cpp" "int main() { return 0; }\n")
file(WRITE "${_test_root}/CMakeLists.txt" [=[
cmake_minimum_required(VERSION 3.24)
project(BurlAppContract VERSION 2.3.4 LANGUAGES CXX)
add_library(pulp_view INTERFACE)
add_library(pulp::view ALIAS pulp_view)
include("@HELPER@")
burl_add_app(ContractApp
    SOURCES main.cpp
    APP_NAME "Contract App"
    BUNDLE_ID "org.burl.contract"
    VERSION "2.3.4")
get_target_property(_output ContractApp OUTPUT_NAME)
get_target_property(_links ContractApp LINK_LIBRARIES)
if(NOT _output STREQUAL "Contract App")
  message(FATAL_ERROR "unexpected OUTPUT_NAME: ${_output}")
endif()
if(NOT "pulp::view" IN_LIST _links)
  message(FATAL_ERROR "ContractApp does not link pulp::view: ${_links}")
endif()
if(APPLE)
  get_target_property(_id ContractApp MACOSX_BUNDLE_GUI_IDENTIFIER)
  get_target_property(_version ContractApp MACOSX_BUNDLE_SHORT_VERSION_STRING)
  if(NOT _id STREQUAL "org.burl.contract" OR NOT _version STREQUAL "2.3.4")
    message(FATAL_ERROR "bundle metadata mismatch: ${_id} ${_version}")
  endif()
endif()
]=])
file(READ "${_test_root}/CMakeLists.txt" _project)
string(REPLACE "@HELPER@" "${CMAKE_CURRENT_LIST_DIR}/../../tools/cmake/PulpAppTargets.cmake"
       _project "${_project}")
file(WRITE "${_test_root}/CMakeLists.txt" "${_project}")

execute_process(
    COMMAND "${CMAKE_COMMAND}" -S "${_test_root}" -B "${_test_root}/build"
    RESULT_VARIABLE _result
    OUTPUT_VARIABLE _stdout
    ERROR_VARIABLE _stderr)
if(NOT _result EQUAL 0)
    message(FATAL_ERROR "burl_add_app contract configure failed:\n${_stdout}\n${_stderr}")
endif()
message(STATUS "burl_add_app contract passed")

set(_negative_root "${_test_root}-missing-sources")
file(REMOVE_RECURSE "${_negative_root}")
file(MAKE_DIRECTORY "${_negative_root}")
file(WRITE "${_negative_root}/CMakeLists.txt" [=[
cmake_minimum_required(VERSION 3.24)
project(BurlAppMissingSources LANGUAGES CXX)
add_library(pulp_view INTERFACE)
add_library(pulp::view ALIAS pulp_view)
include("@HELPER@")
burl_add_app(MissingSources APP_NAME "Must Fail")
]=])
file(READ "${_negative_root}/CMakeLists.txt" _negative_project)
string(REPLACE "@HELPER@" "${CMAKE_CURRENT_LIST_DIR}/../../tools/cmake/PulpAppTargets.cmake"
       _negative_project "${_negative_project}")
file(WRITE "${_negative_root}/CMakeLists.txt" "${_negative_project}")
execute_process(
    COMMAND "${CMAKE_COMMAND}" -S "${_negative_root}" -B "${_negative_root}/build"
    RESULT_VARIABLE _negative_result
    OUTPUT_VARIABLE _negative_stdout
    ERROR_VARIABLE _negative_stderr)
if(_negative_result EQUAL 0 OR NOT _negative_stderr MATCHES "SOURCES is required")
    message(FATAL_ERROR
        "burl_add_app accepted missing SOURCES or emitted the wrong diagnostic:\n${_negative_stdout}\n${_negative_stderr}")
endif()
message(STATUS "burl_add_app missing-SOURCES guard passed")
