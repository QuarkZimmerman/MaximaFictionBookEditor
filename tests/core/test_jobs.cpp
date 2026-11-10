// Feature 011 (contracts/rpc-api.md, Test hooks): `test.slowJobs` pauses every job after each of
// its progress steps, so the journeys can see an export's progress, cancel it and try to close
// the window while it runs.
#include "test_support.hpp"

#include <mfbe/rpc.hpp>

#include <catch2/catch_test_macros.hpp>
#include <chrono>

using namespace mfbe;

TEST_CASE("jobs: the step delay of test.slowJobs slows each progress step", "[rpc][jobs]") {
    rpc::RecordingNotifier notifier;
    rpc::JobManager jobs(notifier);
    const auto run = [&jobs] {
        const auto started = std::chrono::steady_clock::now();
        jobs.start([](rpc::JobControl& c) {
            for (int i = 1; i <= 3; ++i) {
                c.progress("step", i, 3);
            }
            return nlohmann::json::object();
        });
        REQUIRE(jobs.wait_idle(5000));
        return std::chrono::duration_cast<std::chrono::milliseconds>(
                   std::chrono::steady_clock::now() - started)
            .count();
    };
    rpc::set_job_step_delay_ms(80);
    const auto slowed = run();
    rpc::set_job_step_delay_ms(0);
    const auto normal = run();
    CHECK(slowed >= 240);
    CHECK(normal < 240);
    CHECK(notifier.take().size() == 8);  // 3 progress + done, twice
}
