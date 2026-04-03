export interface Timings {
  timeBetweenSearchCycles: number;
  timeToWaitAfterFiveSearchCycles: number;
  timeBetweenUnfollows: number;
  timeToWaitAfterFiveUnfollows: number;
  minBatchSize: number;
  maxBatchSize: number;
  dailyUnfollowCap: number;
}
