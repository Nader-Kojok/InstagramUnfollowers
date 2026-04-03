import React, { useState } from "react";
import { Timings } from "../model/timings";
import { UserNode } from "../model/user";
import { WhitelistManager } from "./WhitelistManager";

interface SettingMenuProps {
  setSettingState: (state: boolean) => void;
  currentTimings: Timings;
  setTimings: (timings: Timings) => void;
  whitelistedUsers: readonly UserNode[];
  onWhitelistUpdate: (users: readonly UserNode[]) => void;
}

export const SettingMenu = ({
  setSettingState,
  currentTimings,
  setTimings,
  whitelistedUsers,
  onWhitelistUpdate,
}: SettingMenuProps) => {
  const [timeBetweenSearchCycles, setTimeBetweenSearchCycles] = useState(currentTimings.timeBetweenSearchCycles);
  const [timeToWaitAfterFiveSearchCycles, setTimeToWaitAfterFiveSearchCycles] = useState(currentTimings.timeToWaitAfterFiveSearchCycles);
  const [timeBetweenUnfollows, setTimeBetweenUnfollows] = useState(currentTimings.timeBetweenUnfollows);
  const [timeToWaitAfterFiveUnfollows, setTimeToWaitAfterFiveUnfollows] = useState(currentTimings.timeToWaitAfterFiveUnfollows);
  const [minBatchSize, setMinBatchSize] = useState(currentTimings.minBatchSize);
  const [maxBatchSize, setMaxBatchSize] = useState(currentTimings.maxBatchSize);
  const [dailyUnfollowCap, setDailyUnfollowCap] = useState(currentTimings.dailyUnfollowCap);

  const handleSave = (event: any) => {
    event.preventDefault();
    setTimings({
      timeBetweenSearchCycles,
      timeToWaitAfterFiveSearchCycles,
      timeBetweenUnfollows,
      timeToWaitAfterFiveUnfollows,
      minBatchSize,
      maxBatchSize,
      dailyUnfollowCap,
    });
    setSettingState(false);
  };

  // @ts-ignore
  const handleInputChange = (event: any, setter: (value: number) => void) => {

    const value = Number(event?.target?.value);
    setter(value);
  };

  return (
    <form onSubmit={handleSave}>
      <div className="backdrop">
        <div className="setting-menu">
          {/* Settings Module */}
          <div className="settings-module">
            <div className="module-header">
              <h3>Settings</h3>
            </div>

            <div className="settings-content">
              <div className="row">
                <label className="minimun-width">Default time between search cycles</label>
                <input
                  type="number"
                  id="searchCycles"
                  name="searchCycles"
                  min={500}
                  max={999999}
                  value={timeBetweenSearchCycles}
                  onChange={(e) => handleInputChange(e, setTimeBetweenSearchCycles)}
                />
                <label className="margin-between-input-and-label">(ms)</label>
              </div>

              <div className="row">
                <label className="minimun-width">Default time to wait after five search cycles</label>
                <input
                  type="number"
                  id="fiveSearchCycles"
                  name="fiveSearchCycles"
                  min={4000}
                  max={999999}
                  value={timeToWaitAfterFiveSearchCycles}
                  onChange={(e) => handleInputChange(e, setTimeToWaitAfterFiveSearchCycles)}
                />
                <label className="margin-between-input-and-label">(ms)</label>
              </div>

              <div className="row">
                <label className="minimun-width">Default time between unfollows</label>
                <input
                  type="number"
                  id="timeBetweenUnfollow"
                  name="timeBetweenUnfollow"
                  min={1000}
                  max={999999}
                  value={timeBetweenUnfollows}
                  onChange={(e) => handleInputChange(e, setTimeBetweenUnfollows)}
                />
                <label className="margin-between-input-and-label">(ms)</label>
              </div>

              <div className="row">
                <label className="minimun-width">Default time to wait after five unfollows</label>
                <input
                  type="number"
                  id="timeAfterFiveUnfollows"
                  name="timeAfterFiveUnfollows"
                  min={70000}
                  max={999999}
                  value={timeToWaitAfterFiveUnfollows}
                  onChange={(e) => handleInputChange(e, setTimeToWaitAfterFiveUnfollows)}
                />
                <label className="margin-between-input-and-label">(ms)</label>
              </div>

              <div className="row">
                <label className="minimun-width">Min batch size (unfollows per batch)</label>
                <input
                  type="number"
                  id="minBatchSize"
                  name="minBatchSize"
                  min={1}
                  max={20}
                  value={minBatchSize}
                  onChange={(e) => handleInputChange(e, setMinBatchSize)}
                />
              </div>

              <div className="row">
                <label className="minimun-width">Max batch size (unfollows per batch)</label>
                <input
                  type="number"
                  id="maxBatchSize"
                  name="maxBatchSize"
                  min={1}
                  max={20}
                  value={maxBatchSize}
                  onChange={(e) => handleInputChange(e, setMaxBatchSize)}
                />
              </div>

              <div className="row">
                <label className="minimun-width">Daily unfollow cap</label>
                <input
                  type="number"
                  id="dailyUnfollowCap"
                  name="dailyUnfollowCap"
                  min={10}
                  max={500}
                  value={dailyUnfollowCap}
                  onChange={(e) => handleInputChange(e, setDailyUnfollowCap)}
                />
              </div>

              <div className="warning-container">
                <h3 className="warning"><b>WARNING:</b> Modifying these settings can lead to your account being banned.</h3>
                <h3 className="warning">USE IT AT YOUR OWN RISK!!!!</h3>
              </div>
            </div>
          </div>

          {/* Divider */}
          <hr className="module-divider" />

          {/* Whitelist Management Module */}
          <div className="whitelist-module">
            <WhitelistManager
              whitelistedUsers={whitelistedUsers}
              onWhitelistUpdate={onWhitelistUpdate}
            />
          </div>

          {/* Action Buttons */}
          <div className="btn-container">
            <button className="btn" type="button" onClick={() => setSettingState(false)}>Cancel</button>
            <button className="btn" type="submit">Save</button>
          </div>
        </div>
      </div>
    </form>
  );
};
