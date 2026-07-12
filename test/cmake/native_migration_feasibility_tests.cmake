if(APPLE AND NOT PULP_IOS)
    pulp_add_test_suite(pulp-test-native-migration-text-ax
        SOURCES test_native_migration_text_ax_feasibility.cpp
        LIBRARIES pulp::view
        PROPERTIES RESOURCE_LOCK system-clipboard)
    add_executable(pulp-native-migration-text-ax-live
        ${CMAKE_SOURCE_DIR}/tools/validation/native_migration_text_ax_live.cpp)
    target_link_libraries(pulp-native-migration-text-ax-live PRIVATE pulp::view)
endif()
