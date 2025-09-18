import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV, listCV, principalCV } from "@stacks/transactions";

const ERR_NOT_ENROLLED = 1001;
const ERR_QUIZ_FAILED = 1002;
const ERR_ALREADY_COMPLETED = 1003;
const ERR_INSUFFICIENT_REWARDS = 1004;
const ERR_INVALID_QUIZ_RESULTS = 1005;
const ERR_INVALID_PROOF = 1006;
const ERR_COURSE_NOT_FOUND = 1007;
const ERR_USER_NOT_REGISTERED = 1008;
const ERR_INVALID_SCORE = 1009;
const ERR_TOKEN_MINT_FAILED = 1010;
const ERR_PROGRESS_UPDATE_FAILED = 1011;
const ERR_INVALID_COURSE_DIFFICULTY = 1012;
const ERR_AUTH_NOT_VERIFIED = 1013;

interface CourseRewardConfig {
  difficulty: number;
  baseReward: number;
  passThreshold: number;
}

interface UserCompletion {
  completed: boolean;
  score: number;
  timestamp: number;
  certId: string;
}

interface EnrollmentKey {
  user: string;
  course: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class QuizManagerMock {
  scoreQuiz(courseId: number, results: number[]): Result<number> {
    return { ok: true, value: Math.floor(Math.random() * 100) + 50 };
  }
}

class RewardTokenMock {
  mint(to: string, amount: number): Result<boolean> {
    return { ok: true, value: true };
  }
}

class ProgressTrackerMock {
  completeCourse(user: string, courseId: number): Result<boolean> {
    return { ok: true, value: true };
  }
}

class RewardDistributorMock {
  state: {
    rewardMultiplier: number;
    adminPrincipal: string;
    totalRewardsMinted: number;
    courseRewards: Map<number, CourseRewardConfig>;
    userCompletions: Map<string, UserCompletion>;
    userEnrollments: Map<string, boolean>;
  } = {
    rewardMultiplier: 100,
    adminPrincipal: "ST1ADMIN",
    totalRewardsMinted: 0,
    courseRewards: new Map(),
    userCompletions: new Map(),
    userEnrollments: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1USER";
  quizManager = new QuizManagerMock();
  rewardToken = new RewardTokenMock();
  progressTracker = new ProgressTrackerMock();

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      rewardMultiplier: 100,
      adminPrincipal: "ST1ADMIN",
      totalRewardsMinted: 0,
      courseRewards: new Map(),
      userCompletions: new Map(),
      userEnrollments: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1USER";
  }

  setAdmin(newAdmin: string): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_AUTH_NOT_VERIFIED };
    this.state.adminPrincipal = newAdmin;
    return { ok: true, value: true };
  }

  setRewardMultiplier(multiplier: number): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_AUTH_NOT_VERIFIED };
    if (multiplier <= 0) return { ok: false, value: ERR_INVALID_SCORE };
    this.state.rewardMultiplier = multiplier;
    return { ok: true, value: true };
  }

  addCourseRewardConfig(courseId: number, difficulty: number, baseReward: number, passThreshold: number): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_AUTH_NOT_VERIFIED };
    if (difficulty < 1 || difficulty > 5) return { ok: false, value: ERR_INVALID_COURSE_DIFFICULTY };
    if (baseReward <= 0) return { ok: false, value: ERR_INSUFFICIENT_REWARDS };
    if (passThreshold <= 0) return { ok: false, value: ERR_INVALID_SCORE };
    this.state.courseRewards.set(courseId, { difficulty, baseReward, passThreshold });
    return { ok: true, value: true };
  }

  enrollUser(courseId: number): Result<boolean> {
    const key = JSON.stringify({ user: this.caller, course: courseId });
    this.state.userEnrollments.set(key, true);
    return { ok: true, value: true };
  }

  completeCourseAndClaim(courseId: number, quizResults: number[], proof: string): Result<any> {
    const enrolledKey = JSON.stringify({ user: this.caller, course: courseId });
    if (!this.state.userEnrollments.get(enrolledKey)) return { ok: false, value: ERR_NOT_ENROLLED };
    const completionKey = enrolledKey;
    const completion = this.state.userCompletions.get(completionKey);
    if (completion?.completed) return { ok: false, value: ERR_ALREADY_COMPLETED };
    if (quizResults.length !== 10) return { ok: false, value: ERR_INVALID_QUIZ_RESULTS };
    if (proof.length === 0) return { ok: false, value: ERR_INVALID_PROOF };
    const scoreResult = this.quizManager.scoreQuiz(courseId, quizResults);
    if (!scoreResult.ok) return { ok: false, value: ERR_QUIZ_FAILED };
    const score = scoreResult.value;
    const config = this.state.courseRewards.get(courseId);
    if (!config) return { ok: false, value: ERR_COURSE_NOT_FOUND };
    const threshold = config.passThreshold;
    if (score < threshold) return { ok: false, value: ERR_QUIZ_FAILED };
    const base = config.baseReward;
    const adjusted = Math.floor((base * score) / threshold);
    const rewards = adjusted * this.state.rewardMultiplier;
    const tokenResult = this.rewardToken.mint(this.caller, rewards);
    if (!tokenResult.ok) return { ok: false, value: ERR_TOKEN_MINT_FAILED };
    const progressResult = this.progressTracker.completeCourse(this.caller, courseId);
    if (!progressResult.ok) return { ok: false, value: ERR_PROGRESS_UPDATE_FAILED };
    const certId = "CERT-" + Math.random().toString(36).substr(2, 9).toUpperCase();
    this.state.userCompletions.set(completionKey, { completed: true, score, timestamp: this.blockHeight, certId });
    this.state.totalRewardsMinted += rewards;
    return {
      ok: true,
      value: { tokensAwarded: rewards, certificationId: certId, timestamp: this.blockHeight }
    };
  }

  getTotalRewardsMinted(): Result<number> {
    return { ok: true, value: this.state.totalRewardsMinted };
  }

  getCourseRewardConfig(courseId: number): CourseRewardConfig | null {
    return this.state.courseRewards.get(courseId) || null;
  }

  getUserCompletion(user: string, course: number): UserCompletion | null {
    const key = JSON.stringify({ user, course });
    return this.state.userCompletions.get(key) || null;
  }

  isUserEnrolled(user: string, course: number): boolean {
    const key = JSON.stringify({ user, course });
    return this.state.userEnrollments.get(key) || false;
  }
}

describe("RewardDistributor", () => {
  let contract: RewardDistributorMock;

  beforeEach(() => {
    contract = new RewardDistributorMock();
    contract.reset();
    contract.caller = "ST1USER";
  });

  it("adds course reward config successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.addCourseRewardConfig(1, 3, 100, 80);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const config = contract.getCourseRewardConfig(1);
    expect(config?.difficulty).toBe(3);
    expect(config?.baseReward).toBe(100);
    expect(config?.passThreshold).toBe(80);
  });

  it("rejects add course config without admin auth", () => {
    const result = contract.addCourseRewardConfig(1, 3, 100, 80);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTH_NOT_VERIFIED);
  });

  it("rejects invalid difficulty in course config", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.addCourseRewardConfig(1, 6, 100, 80);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_COURSE_DIFFICULTY);
  });

  it("enrolls user successfully", () => {
    const result = contract.enrollUser(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.isUserEnrolled("ST1USER", 1)).toBe(true);
  });

  it("rejects completion without enrollment", () => {
    const quizResults = [1,2,3,4,5,6,7,8,9,10];
    const proof = "valid-proof";
    const result = contract.completeCourseAndClaim(1, quizResults, proof);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_ENROLLED);
  });

  it("rejects invalid quiz results length", () => {
    contract.addCourseRewardConfig(1, 2, 50, 70);
    contract.enrollUser(1);
    const quizResults = [1,2,3,4,5,6,7,8,9];
    const proof = "valid-proof";
    const result = contract.completeCourseAndClaim(1, quizResults, proof);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_QUIZ_RESULTS);
  });

  it("rejects invalid proof", () => {
    contract.addCourseRewardConfig(1, 2, 50, 70);
    contract.enrollUser(1);
    const quizResults = [1,2,3,4,5,6,7,8,9,10];
    const result = contract.completeCourseAndClaim(1, quizResults, "");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROOF);
  });

  it("rejects course without config", () => {
    contract.enrollUser(1);
    const quizResults = [1,2,3,4,5,6,7,8,9,10];
    const proof = "valid-proof";
    const result = contract.completeCourseAndClaim(1, quizResults, proof);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_COURSE_NOT_FOUND);
  });

  it("sets reward multiplier successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setRewardMultiplier(200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.rewardMultiplier).toBe(200);
  });

  it("rejects set multiplier without admin", () => {
    const result = contract.setRewardMultiplier(200);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTH_NOT_VERIFIED);
  });

  it("rejects invalid multiplier", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setRewardMultiplier(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SCORE);
  });
});