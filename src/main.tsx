import React, { ChangeEvent, useEffect, useRef, useState } from "react";
import { render } from "react-dom";
import "./styles.scss";

import { User, UserNode } from "./model/user";
import { Toast } from "./components/Toast";
import { UserCheckIcon } from "./components/icons/UserCheckIcon";
import { UserUncheckIcon } from "./components/icons/UserUncheckIcon";
import { DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
  DEFAULT_TIME_BETWEEN_UNFOLLOWS,
  DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
  DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS,
  DEFAULT_MIN_BATCH_SIZE,
  DEFAULT_MAX_BATCH_SIZE,
  DEFAULT_DAILY_UNFOLLOW_CAP,
  MAX_SCAN_RETRIES,
  MAX_CONSECUTIVE_UNFOLLOW_FAILURES,
  FAILURE_BACKOFF_MULTIPLIER,
  LONG_PAUSE_ON_FAILURES_MS,
  TIMINGS_STORAGE_KEY,
  SCAN_RESULTS_STORAGE_KEY,
  INSTAGRAM_HOSTNAME } from "./constants/constants";
import {
  assertUnreachable,
  getCookie,
  getCurrentPageUnfollowers,
  getUsersForDisplay, humanizedSleep, getRandomBatchSize,
  getDailyUnfollowCount, incrementDailyUnfollowCount,
  sleep, unfollowUserUrlGenerator, urlGenerator,
} from "./utils/utils";
import { NotSearching } from "./components/NotSearching";
import { State } from "./model/state";
import { Searching } from "./components/Searching";
import { Toolbar } from "./components/Toolbar";
import { Unfollowing } from "./components/Unfollowing";
import { Timings } from "./model/timings";
import { loadWhitelist, saveWhitelist } from "./utils/whitelist-manager";

function loadTimingsFromStorage(): Timings {
  try {
    const stored = localStorage.getItem(TIMINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        timeBetweenSearchCycles: parsed.timeBetweenSearchCycles ?? DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
        timeToWaitAfterFiveSearchCycles: parsed.timeToWaitAfterFiveSearchCycles ?? DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
        timeBetweenUnfollows: parsed.timeBetweenUnfollows ?? DEFAULT_TIME_BETWEEN_UNFOLLOWS,
        timeToWaitAfterFiveUnfollows: parsed.timeToWaitAfterFiveUnfollows ?? DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS,
        minBatchSize: parsed.minBatchSize ?? DEFAULT_MIN_BATCH_SIZE,
        maxBatchSize: parsed.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
        dailyUnfollowCap: parsed.dailyUnfollowCap ?? DEFAULT_DAILY_UNFOLLOW_CAP,
      };
    }
  } catch (_e) { /* ignore parse errors */ }
  return {
    timeBetweenSearchCycles: DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
    timeToWaitAfterFiveSearchCycles: DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
    timeBetweenUnfollows: DEFAULT_TIME_BETWEEN_UNFOLLOWS,
    timeToWaitAfterFiveUnfollows: DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS,
    minBatchSize: DEFAULT_MIN_BATCH_SIZE,
    maxBatchSize: DEFAULT_MAX_BATCH_SIZE,
    dailyUnfollowCap: DEFAULT_DAILY_UNFOLLOW_CAP,
  };
}

function saveScanResults(results: readonly UserNode[]): void {
  try {
    sessionStorage.setItem(SCAN_RESULTS_STORAGE_KEY, JSON.stringify(results));
  } catch (_e) { /* ignore quota errors */ }
}

function loadScanResults(): readonly UserNode[] | null {
  try {
    const stored = sessionStorage.getItem(SCAN_RESULTS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (_e) { /* ignore parse errors */ }
  return null;
}

function clearScanResults(): void {
  sessionStorage.removeItem(SCAN_RESULTS_STORAGE_KEY);
}

function loadInitialState(): State {
  const cachedResults = loadScanResults();
  if (cachedResults && cachedResults.length > 0) {
    return {
      status: "scanning",
      page: 1,
      searchTerm: "",
      currentTab: "non_whitelisted",
      percentage: 100,
      results: cachedResults,
      selectedResults: [],
      whitelistedResults: loadWhitelist(),
      filter: {
        showNonFollowers: true,
        showFollowers: false,
        showVerified: true,
        showPrivate: true,
        showWithOutProfilePicture: true,
      },
    };
  }
  return { status: "initial" };
}

function App() {
  const [state, setState] = useState<State>(loadInitialState);

  const [toast, setToast] = useState<{ readonly show: false } | { readonly show: true; readonly text: string }>({
    show: false,
  });

  const scanningPausedRef = useRef(false);
  const unfollowCancelledRef = useRef(false);

  const pauseScan = () => {
    scanningPausedRef.current = !scanningPausedRef.current;
    // Force re-render so the button text updates
    setState(prev => ({ ...prev }));
  };

  const cancelUnfollow = () => {
    unfollowCancelledRef.current = true;
    setState(prev => {
      if (prev.status !== "unfollowing") return prev;
      return { ...prev, cancelled: true };
    });
  };

  const [timings, setTimingsState] = useState<Timings>(loadTimingsFromStorage);

  const setTimings = (newTimings: Timings) => {
    setTimingsState(newTimings);
    localStorage.setItem(TIMINGS_STORAGE_KEY, JSON.stringify(newTimings));
  };

  const timingsRef = useRef(timings);
  useEffect(() => { timingsRef.current = timings; }, [timings]);

  // Show a toast when scan results were restored from cache
  const restoredFromCache = useRef(false);
  useEffect(() => {
    if (!restoredFromCache.current && state.status === "scanning" && state.percentage === 100 && state.results.length > 0) {
      restoredFromCache.current = true;
      setToast({ show: true, text: `Restored ${state.results.length} scan results from previous session.` });
    }
  }, []);


  let isActiveProcess: boolean;
  switch (state.status) {
    case "initial":
      isActiveProcess = false;
      break;
    case "scanning":
      isActiveProcess = state.percentage < 100;
      break;
    case "unfollowing":
      isActiveProcess = state.percentage < 100 && !state.cancelled;
      break;
    default:
      assertUnreachable(state);
  }

  const onScan = async () => {
    if (state.status !== "initial") {
      return;
    }
    const whitelistedResults = loadWhitelist();
    setState({
      status: "scanning",
      page: 1,
      searchTerm: "",
      currentTab: "non_whitelisted",
      percentage: 0,
      results: [],
      selectedResults: [],
      whitelistedResults,
      filter: {
        showNonFollowers: true,
        showFollowers: false,
        showVerified: true,
        showPrivate: true,
        showWithOutProfilePicture: true,
      },
    });
  };

  const handleScanFilter = (e: ChangeEvent<HTMLInputElement>) => {
    if (state.status !== "scanning") {
      return;
    }
    if (state.selectedResults.length > 0) {
      if (!confirm("Changing filter options will clear selected users")) {
        // Force re-render. Bit of a hack but had an issue where the checkbox state was still
        // changing in the UI even even when not confirming. So updating the state fixes this
        // by synchronizing the checkboxes with the filter statuses in the state.
        setState({ ...state });
        return;
      }
    }
    setState({
      ...state,
      // Make sure to clear selected results when changing filter options. This is to avoid having
      // users selected in the unfollow queue but not visible in the UI, which would be confusing.
      selectedResults: [],
      filter: {
        ...state.filter,
        [e.currentTarget.name]: e.currentTarget.checked,
      },
    });
  };

  const handleUnfollowFilter = (e: ChangeEvent<HTMLInputElement>) => {
    if (state.status !== "unfollowing") {
      return;
    }
    setState({
      ...state,
      filter: {
        ...state.filter,
        [e.currentTarget.name]: e.currentTarget.checked,
      },
    });
  };

  const toggleUser = (newStatus: boolean, user: UserNode) => {
    if (state.status !== "scanning") {
      return;
    }
    if (newStatus) {
      setState({
        ...state,
        selectedResults: [...state.selectedResults, user],
      });
    } else {
      setState({
        ...state,
        selectedResults: state.selectedResults.filter(result => result.id !== user.id),
      });
    }
  };

  const toggleAllUsers = (e: ChangeEvent<HTMLInputElement>) => {
    if (state.status !== "scanning") {
      return;
    }
    if (e.currentTarget.checked) {
      setState({
        ...state,
        selectedResults: getUsersForDisplay(
          state.results,
          state.whitelistedResults,
          state.currentTab,
          state.searchTerm,
          state.filter,
        ),
      });
    } else {
      setState({
        ...state,
        selectedResults: [],
      });
    }
  };

  // it will work the same as toggleAllUsers, but it will select everyone on the current page.
  const toggleCurrentePageUsers = (e: ChangeEvent<HTMLInputElement>) => {
    if (state.status !== "scanning") {
      return;
    }
    if (e.currentTarget.checked) {
      setState({
        ...state,
        selectedResults: getCurrentPageUnfollowers(
          getUsersForDisplay(
            state.results,
            state.whitelistedResults,
            state.currentTab,
            state.searchTerm,
            state.filter,
          ),
          state.page,
        ),
      });
    } else {
      setState({
        ...state,
        selectedResults: [],
      });
    }
  };

  const onWhitelistUpdate = (updatedWhitelist: readonly UserNode[]) => {
    saveWhitelist(updatedWhitelist);
    if (state.status === "scanning") {
      setState({
        ...state,
        whitelistedResults: updatedWhitelist,
      });
    }
  };

  const onResetToInitial = () => {
    clearScanResults();
    setState({ status: "initial" });
  };

  const goBackToScanResults = () => {
    const cachedResults = loadScanResults();
    if (cachedResults && cachedResults.length > 0) {
      setState({
        status: "scanning",
        page: 1,
        searchTerm: "",
        currentTab: "non_whitelisted",
        percentage: 100,
        results: cachedResults,
        selectedResults: [],
        whitelistedResults: loadWhitelist(),
        filter: {
          showNonFollowers: true,
          showFollowers: false,
          showVerified: true,
          showPrivate: true,
          showWithOutProfilePicture: true,
        },
      });
    } else {
      onResetToInitial();
    }
  };

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Prompt user if he tries to leave while in the middle of a process (searching / unfollowing / etc..)
      // This is especially good for avoiding accidental tab closing which would result in a frustrating experience.
      if (!isActiveProcess) {
        return;
      }

      // `e` Might be undefined in older browsers, so silence linter for this one.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      e = e || window.event;

      // `e` Might be undefined in older browsers, so silence linter for this one.
      // For IE and Firefox prior to version 4
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (e) {
        e.returnValue = "Changes you made may not be saved.";
      }

      // For Safari
      return "Changes you made may not be saved.";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isActiveProcess, state]);

  useEffect(() => {
    const scan = async () => {
      if (state.status !== "scanning") {
        return;
      }
      // If we restored from cache (percentage 100), don't re-scan
      if (state.percentage === 100 && state.results.length > 0) {
        return;
      }
      const results = [...state.results];
      let scrollCycle = 0;
      let url = urlGenerator();
      let hasNext = true;
      let currentFollowedUsersCount = 0;
      let totalFollowedUsersCount = -1;
      let consecutiveErrors = 0;

      while (hasNext) {
        let receivedData: User;
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          receivedData = (await response.json()).data.user.edge_follow;
          consecutiveErrors = 0;
        } catch (e) {
          console.error(e);
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_SCAN_RETRIES) {
            setToast({ show: true, text: `Scan stopped after ${MAX_SCAN_RETRIES} consecutive errors. Try again later.` });
            return;
          }
          const backoffMs = Math.min(timingsRef.current.timeBetweenSearchCycles * Math.pow(2, consecutiveErrors), 60000);
          setToast({ show: true, text: `Scan error, retrying in ${Math.round(backoffMs / 1000)}s (${consecutiveErrors}/${MAX_SCAN_RETRIES})...` });
          await sleep(backoffMs);
          continue;
        }

        if (totalFollowedUsersCount === -1) {
          totalFollowedUsersCount = receivedData.count;
        }

        hasNext = receivedData.page_info.has_next_page;
        url = urlGenerator(receivedData.page_info.end_cursor);
        currentFollowedUsersCount += receivedData.edges.length;
        receivedData.edges.forEach(x => results.push(x.node));

        setState(prevState => {
          if (prevState.status !== "scanning") {
            return prevState;
          }
          const newState: State = {
            ...prevState,
            percentage: Math.round((currentFollowedUsersCount / totalFollowedUsersCount) * 100),
            results,
          };
          return newState;
        });

        // Pause scanning if user requested so.
        while (scanningPausedRef.current) {
          await sleep(1000);
          console.info("Scan paused");
        }

        await humanizedSleep(timingsRef.current.timeBetweenSearchCycles);
        scrollCycle++;
        if (scrollCycle > 5) {
          scrollCycle = 0;
          setToast({ show: true, text: `Sleeping ${timingsRef.current.timeToWaitAfterFiveSearchCycles / 1000 } seconds to prevent getting temp blocked` });
          await humanizedSleep(timingsRef.current.timeToWaitAfterFiveSearchCycles);
        }
        setToast({ show: false });
      }
      // Save completed scan results to sessionStorage
      saveScanResults(results);
      setToast({ show: true, text: "Scanning completed!" });
    };
    scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  useEffect(() => {
    const unfollow = async () => {
      if (state.status !== "unfollowing") {
        return;
      }

      unfollowCancelledRef.current = false;

      const csrftoken = getCookie("csrftoken");
      if (csrftoken === null) {
        throw new Error("csrftoken cookie is null");
      }

      let counter = 0;
      let consecutiveFailures = 0;
      const currentBatchSize = getRandomBatchSize(timingsRef.current.minBatchSize, timingsRef.current.maxBatchSize);
      let batchCounter = 0;

      for (const user of state.selectedResults) {
        // Check if user cancelled
        if (unfollowCancelledRef.current) {
          setToast({ show: true, text: `Unfollowing cancelled. ${counter} users processed.` });
          return;
        }

        // Check daily cap
        const dailyCount = getDailyUnfollowCount();
        if (dailyCount >= timingsRef.current.dailyUnfollowCap) {
          setToast({ show: true, text: `Daily unfollow limit reached (${timingsRef.current.dailyUnfollowCap}). Resume tomorrow to stay safe.` });
          return;
        }

        counter += 1;
        batchCounter += 1;
        const percentage = Math.round((counter / state.selectedResults.length) * 100);
        let unfollowedSuccessfully = false;

        try {
          const response = await fetch(unfollowUserUrlGenerator(user.id), {
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              "x-csrftoken": csrftoken,
            },
            method: "POST",
            mode: "cors",
            credentials: "include",
          });

          if (response.ok) {
            try {
              const body = await response.json();
              // Instagram returns {status: "ok"} on success
              unfollowedSuccessfully = body.status === "ok";
              if (!unfollowedSuccessfully) {
                console.warn("Unfollow response not ok:", body);
              }
            } catch (_e) {
              // Some endpoints return empty body on success (200 with no JSON)
              unfollowedSuccessfully = true;
            }
          } else if (response.status === 429 || response.status === 400) {
            // Rate limited or action blocked — long pause
            console.warn(`Rate limited (HTTP ${response.status}), backing off...`);
            consecutiveFailures = MAX_CONSECUTIVE_UNFOLLOW_FAILURES;
            unfollowedSuccessfully = false;
          } else {
            console.error(`Unfollow failed: HTTP ${response.status}`);
            unfollowedSuccessfully = false;
          }

          if (unfollowedSuccessfully) {
            consecutiveFailures = 0;
            incrementDailyUnfollowCount();
          } else {
            consecutiveFailures++;
          }

          setState(prevState => {
            if (prevState.status !== "unfollowing") {
              return prevState;
            }
            return {
              ...prevState,
              percentage,
              unfollowLog: [
                ...prevState.unfollowLog,
                { user, unfollowedSuccessfully },
              ],
            };
          });
        } catch (e) {
          console.error(e);
          consecutiveFailures++;
          setState(prevState => {
            if (prevState.status !== "unfollowing") {
              return prevState;
            }
            return {
              ...prevState,
              percentage,
              unfollowLog: [
                ...prevState.unfollowLog,
                { user, unfollowedSuccessfully: false },
              ],
            };
          });
        }

        // Exponential backoff on consecutive failures
        if (consecutiveFailures >= MAX_CONSECUTIVE_UNFOLLOW_FAILURES) {
          const pauseMinutes = Math.round(LONG_PAUSE_ON_FAILURES_MS / 60000);
          setToast({ show: true, text: `${consecutiveFailures} consecutive failures detected. Pausing ${pauseMinutes} minutes (possible shadow-ban).` });
          await sleep(LONG_PAUSE_ON_FAILURES_MS);
          consecutiveFailures = 0;
          batchCounter = 0;
          setToast({ show: false });
          continue;
        }

        // If unfollowing the last user in the list, no reason to wait.
        if (user === state.selectedResults[state.selectedResults.length - 1]) {
          break;
        }

        // Humanized delay between unfollows
        await humanizedSleep(timingsRef.current.timeBetweenUnfollows * (consecutiveFailures > 0 ? Math.pow(FAILURE_BACKOFF_MULTIPLIER, consecutiveFailures) : 1));

        // Randomized batch cooldown
        if (batchCounter >= currentBatchSize) {
          batchCounter = 0;
          const cooldownMs = timingsRef.current.timeToWaitAfterFiveUnfollows;
          const jitteredCooldown = cooldownMs * (0.6 + Math.random() * 0.8);
          setToast({ show: true, text: `Batch of ${currentBatchSize} done. Sleeping ${Math.round(jitteredCooldown / 60000)} minutes to prevent getting temp blocked` });
          await sleep(Math.floor(jitteredCooldown));
        }
        setToast({ show: false });
      }
    };
    unfollow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  let markup: React.JSX.Element;
  switch (state.status) {
    case "initial":
      markup = <NotSearching onScan={onScan}></NotSearching>;
      break;

    case "scanning": {
      markup = <Searching
        state={state}
        handleScanFilter={handleScanFilter}
        toggleUser={toggleUser}
        pauseScan={pauseScan}
        setState={setState}
        scanningPaused={scanningPausedRef.current}
        UserCheckIcon={UserCheckIcon}
        UserUncheckIcon={UserUncheckIcon}
      ></Searching>;
      break;
    }

    case "unfollowing":
      markup = <Unfollowing
        state={state}
        handleUnfollowFilter={handleUnfollowFilter}
        cancelUnfollow={cancelUnfollow}
        goBackToScanResults={goBackToScanResults}
      ></Unfollowing>;
      break;

    default:
      assertUnreachable(state);
  }

  return (
    <main id="main" role="main" className="iu">
      <section className="overlay">
        <Toolbar
          state={state}
          setState={setState}
          isActiveProcess={isActiveProcess}
          toggleAllUsers={toggleAllUsers}
          toggleCurrentePageUsers={toggleCurrentePageUsers}
          setTimings={setTimings}
          currentTimings={timings}
          whitelistedUsers={state.status === "scanning" ? state.whitelistedResults : loadWhitelist()}
          onWhitelistUpdate={onWhitelistUpdate}
          onResetToInitial={onResetToInitial}
        ></Toolbar>

        {markup}

        {toast.show && <Toast show={toast.show} message={toast.text} onClose={() => setToast({ show: false })} />}
      </section>
    </main>
  );
}

if (location.hostname !== INSTAGRAM_HOSTNAME) {
  alert("Can be used only on Instagram routes");
} else {
  document.title = "InstagramUnfollowers";
  document.body.innerHTML = "";
  render(<App />, document.body);
}
