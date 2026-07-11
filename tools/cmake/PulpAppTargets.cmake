# PulpAppTargets.cmake — standalone audio app + generic app targets.
#
# App-target helpers shared by source builds and installed SDK consumers.
# Both `_pulp_add_standalone` (the standalone audio-host shell used by
# `pulp_add_plugin(... FORMATS standalone)`) and `pulp_add_app`
# (generic non-plugin Pulp apps) live here.
function(_pulp_add_standalone target name bundle_id version)
    if(NOT _PULP_STANDALONE_TARGET)
        message(FATAL_ERROR "pulp_add_plugin(${target}): Standalone requested but Pulp::standalone is unavailable")
    endif()

    # Find standalone entry (convention: main.cpp in source dir)
    set(standalone_entry "")
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/main.cpp")
        set(standalone_entry "${CMAKE_CURRENT_SOURCE_DIR}/main.cpp")
    endif()

    if(APPLE)
        add_executable(${target}_Standalone MACOSX_BUNDLE
            ${PULP_${target}_CORE_OBJECTS}
            ${standalone_entry}
        )
    else()
        add_executable(${target}_Standalone
            ${PULP_${target}_CORE_OBJECTS}
            ${standalone_entry}
        )
    endif()
    target_link_libraries(${target}_Standalone PRIVATE
        ${target}_Core
        ${_PULP_STANDALONE_TARGET}
    )
    _pulp_apply_ui_script_definition(${target}_Standalone "${PULP_${target}_UI_SCRIPT}")
    _pulp_apply_view_mac_objc_suffix(${target}_Standalone)
    target_include_directories(${target}_Standalone PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    set_target_properties(${target}_Standalone PROPERTIES
        OUTPUT_NAME "${name}"
    )
    if(APPLE)
        set_target_properties(${target}_Standalone PROPERTIES
            MACOSX_BUNDLE TRUE
            MACOSX_BUNDLE_BUNDLE_NAME "${name}"
            MACOSX_BUNDLE_GUI_IDENTIFIER "${bundle_id}"
            MACOSX_BUNDLE_BUNDLE_VERSION "${version}"
            MACOSX_BUNDLE_SHORT_VERSION_STRING "${version}"
        )
    endif()
    if(COMMAND target_copy_webgpu_binaries)
        target_copy_webgpu_binaries(${target}_Standalone)
    endif()
    # Portability guard (runs AFTER the WebGPU dylib is bundled, so a correctly
    # set-up standalone is clean): fail/warn if the binary bakes a build-tree
    # absolute path — the "works on the build box, breaks when shared" footgun.
    include("${CMAKE_CURRENT_FUNCTION_LIST_DIR}/PulpPortable.cmake")
    pulp_assert_portable_bundle(${target}_Standalone)
    _pulp_attach_plugin_runtime_manifest(${target} ${target}_Standalone)
    # Linux+GNU-ld link-order fix: libskia.a → fontconfig. Same helper
    # used for pulp-cli (#1986) and pulp-import-design (#2018). Standalone
    # transitively pulls in pulp::view → pulp::canvas → libskia.a, which
    # references Fc* symbols. Re-mention fontconfig AFTER the archive so
    # the linker resolves them. No-op on macOS/Windows/Android.
    #
    # CMAKE_CURRENT_FUNCTION_LIST_DIR (NOT CMAKE_CURRENT_LIST_DIR or
    # CMAKE_SOURCE_DIR) — CMake's CMAKE_CURRENT_LIST_DIR inside a function
    # body resolves to the *caller's* dir, not where the function was
    # defined. CMAKE_CURRENT_FUNCTION_LIST_DIR (CMake 3.17+; Pulp pins
    # 3.24) is the one that consistently resolves to PulpUtils.cmake's
    # own dir — i.e., the in-tree tools/cmake/ during a source build,
    # and ~/.pulp/sdk/<ver>/lib/cmake/Pulp/ after install. The sibling
    # PulpLinkFontconfig.cmake ships alongside via root CMakeLists.txt's
    # install(FILES) block. Using CMAKE_SOURCE_DIR here broke Linux/Android
    # consumers because it resolved to the consumer's source tree.
    include("${CMAKE_CURRENT_FUNCTION_LIST_DIR}/PulpLinkFontconfig.cmake")
    pulp_link_fontconfig_after_skia(${target}_Standalone)
endfunction()

# ── pulp_add_app ────────────────────────────────────────────────────────
# Usage:
#   pulp_add_app(MyApp
#       APP_NAME "My App"
#       BUNDLE_ID "com.mycompany.myapp"
#       VERSION "1.0.0"
#   )
function(pulp_add_app target)
    cmake_parse_arguments(APP
        ""
        "APP_NAME;BUNDLE_ID;VERSION"
        ""
        ${ARGN}
    )

    if(APPLE)
        add_executable(${target} MACOSX_BUNDLE)
    else()
        add_executable(${target})
    endif()

    if(APP_APP_NAME)
        target_compile_definitions(${target} PRIVATE
            PULP_APP_NAME="${APP_APP_NAME}"
        )
    endif()

    if(APP_BUNDLE_ID)
        target_compile_definitions(${target} PRIVATE
            PULP_BUNDLE_ID="${APP_BUNDLE_ID}"
        )
    endif()

    message(STATUS "Pulp app: ${target}")
endfunction()

# ── burl_add_app ────────────────────────────────────────────────────────
# Product-neutral native application target. Unlike the legacy partial
# pulp_add_app helper, this owns the complete executable/bundle wiring but has
# no plugin, processor, audio-host, or runtime-manifest coupling.
#
# Usage:
#   burl_add_app(MyApp
#       SOURCES main.cpp
#       APP_NAME "My App"
#       BUNDLE_ID "com.example.my-app"
#       VERSION "1.0.0"
#   )
function(burl_add_app target)
    cmake_parse_arguments(BURL_APP
        ""
        "APP_NAME;BUNDLE_ID;VERSION"
        "SOURCES"
        ${ARGN}
    )

    if(BURL_APP_UNPARSED_ARGUMENTS)
        message(FATAL_ERROR
            "burl_add_app(${target}): unknown arguments: ${BURL_APP_UNPARSED_ARGUMENTS}")
    endif()
    if(NOT BURL_APP_SOURCES)
        message(FATAL_ERROR "burl_add_app(${target}): SOURCES is required")
    endif()
    if(NOT TARGET pulp::view)
        message(FATAL_ERROR
            "burl_add_app(${target}): pulp::view is unavailable; link a Burl/Pulp SDK with native view support")
    endif()

    if(NOT BURL_APP_APP_NAME)
        set(BURL_APP_APP_NAME "${target}")
    endif()
    if(NOT BURL_APP_BUNDLE_ID)
        set(BURL_APP_BUNDLE_ID "org.burl.${target}")
    endif()
    if(NOT BURL_APP_VERSION)
        if(PROJECT_VERSION)
            set(BURL_APP_VERSION "${PROJECT_VERSION}")
        else()
            set(BURL_APP_VERSION "0.1.0")
        endif()
    endif()

    if(APPLE)
        add_executable(${target} MACOSX_BUNDLE ${BURL_APP_SOURCES})
    else()
        add_executable(${target} ${BURL_APP_SOURCES})
    endif()

    target_link_libraries(${target} PRIVATE pulp::view)
    target_compile_definitions(${target} PRIVATE
        BURL_APP_NAME="${BURL_APP_APP_NAME}"
        BURL_BUNDLE_ID="${BURL_APP_BUNDLE_ID}"
        BURL_APP_VERSION="${BURL_APP_VERSION}"
    )
    set_target_properties(${target} PROPERTIES OUTPUT_NAME "${BURL_APP_APP_NAME}")

    if(APPLE)
        set_target_properties(${target} PROPERTIES
            MACOSX_BUNDLE TRUE
            MACOSX_BUNDLE_BUNDLE_NAME "${BURL_APP_APP_NAME}"
            MACOSX_BUNDLE_GUI_IDENTIFIER "${BURL_APP_BUNDLE_ID}"
            MACOSX_BUNDLE_BUNDLE_VERSION "${BURL_APP_VERSION}"
            MACOSX_BUNDLE_SHORT_VERSION_STRING "${BURL_APP_VERSION}"
        )
    endif()

    if(COMMAND _pulp_apply_view_mac_objc_suffix)
        _pulp_apply_view_mac_objc_suffix(${target})
    endif()
    if(COMMAND target_copy_webgpu_binaries)
        target_copy_webgpu_binaries(${target})
    endif()

    include("${CMAKE_CURRENT_FUNCTION_LIST_DIR}/PulpPortable.cmake")
    pulp_assert_portable_bundle(${target})

    # Skia's static archive needs fontconfig after it with GNU ld. This helper
    # is a no-op on Apple/Windows and is safe for installed SDK consumers.
    include("${CMAKE_CURRENT_FUNCTION_LIST_DIR}/PulpLinkFontconfig.cmake")
    pulp_link_fontconfig_after_skia(${target})

    message(STATUS "Burl app: ${target} (${BURL_APP_APP_NAME})")
endfunction()

# pulp_add_binary_data() lives in PulpEmbedData.cmake so callers (e.g.
# core/canvas — bundled-font registration, #932) can include it before the
# Pulp targets exist. The function definition is unchanged; this PulpUtils
# include() preserves the existing public surface of `include(PulpUtils)`.
include("${CMAKE_CURRENT_LIST_DIR}/PulpEmbedData.cmake")

# pulp_register_font() — public font-registration macro for plugin authors.
# Lives in its own file so SDK consumers who only want
# pulp_add_binary_data don't pay for the extra includes/parsing, and so the
# install layout can ship the font macro alongside the rest of the Pulp
# CMake helpers.
include("${CMAKE_CURRENT_LIST_DIR}/PulpFonts.cmake")
