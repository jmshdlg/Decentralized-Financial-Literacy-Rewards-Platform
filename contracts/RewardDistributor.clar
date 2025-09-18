(define-constant ERR-NOT-ENROLLED (err u1001))
(define-constant ERR_QUIZ_FAILED (err u1002))
(define-constant ERR_ALREADY_COMPLETED (err u1003))
(define-constant ERR_INSUFFICIENT_REWARDS (err u1004))
(define-constant ERR_INVALID_QUIZ_RESULTS (err u1005))
(define-constant ERR_INVALID_PROOF (err u1006))
(define-constant ERR_COURSE_NOT_FOUND (err u1007))
(define-constant ERR_USER_NOT_REGISTERED (err u1008))
(define-constant ERR_INVALID_SCORE (err u1009))
(define-constant ERR_TOKEN_MINT_FAILED (err u1010))
(define-constant ERR_PROGRESS_UPDATE_FAILED (err u1011))
(define-constant ERR_INVALID_COURSE_DIFFICULTY (err u1012))
(define-constant ERR_AUTH_NOT_VERIFIED (err u1013))

(define-data-var reward-multiplier uint u100)
(define-data-var admin-principal principal tx-sender)
(define-data-var total-rewards-minted uint u0)

(define-map course-rewards
  uint
  {
    difficulty: uint,
    base-reward: uint,
    pass-threshold: uint
  }
)

(define-map user-completions
  { user: principal, course: uint }
  {
    completed: bool,
    score: uint,
    timestamp: uint,
    cert-id: (string-ascii 34)
  }
)

(define-map user-enrollments
  { user: principal, course: uint }
  bool
)

(define-read-only (get-course-reward-config (course-id uint))
  (map-get? course-rewards course-id)
)

(define-read-only (get-user-completion (user principal) (course uint))
  (map-get? user-completions { user: user, course: course })
)

(define-read-only (is-user-enrolled (user principal) (course uint))
  (default-to false (map-get? user-enrollments { user: user, course: course }))
)

(define-read-only (calculate-rewards (course-id uint) (score uint))
  (let (
    (config (unwrap! (map-get? course-rewards course-id) ERR_COURSE_NOT_FOUND))
    (base (get base-reward config))
    (multiplier (var-get reward-multiplier))
    (adjusted (* base (/ score (get pass-threshold config))))
  )
    (ok (* adjusted multiplier))
  )
)

(define-private (validate-quiz-results (results (list 10 uint)))
  (if (is-eq (len results) u10) (ok true) ERR_INVALID_QUIZ_RESULTS)
)

(define-private (validate-proof (proof (string-ascii 64)))
  (if (> (len proof) u0) (ok true) ERR_INVALID_PROOF)
)

(define-private (generate-cert-id (user principal) (course uint) (height uint))
  (let (
    (user-str (principal-to-string user))
    (course-str (to-uint course))
    (hash-input (concat user-str (concat (to-uint course) (to-uint height))))
  )
    (ok (as-max-len? (sha256 (as-max-len? hash-input u32)) u34))
  )
)

(define-private (is-course-completed (completion (optional
  {
    completed: bool,
    score: uint,
    timestamp: uint,
    cert-id: (string-ascii 34)
  }
)))
  (match completion
    c (get completed c)
    false
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin-principal)) ERR_AUTH_NOT_VERIFIED)
    (var-set admin-principal new-admin)
    (ok true)
  )
)

(define-public (set-reward-multiplier (multiplier uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin-principal)) ERR_AUTH_NOT_VERIFIED)
    (asserts! (> multiplier u0) ERR_INVALID_SCORE)
    (var-set reward-multiplier multiplier)
    (ok true)
  )
)

(define-public (add-course-reward-config (course-id uint) (difficulty uint) (base-reward uint) (pass-threshold uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin-principal)) ERR_AUTH_NOT_VERIFIED)
    (asserts! (and (> difficulty u0) (<= difficulty u5)) ERR_INVALID_COURSE_DIFFICULTY)
    (asserts! (> base-reward u0) ERR_INSUFFICIENT_REWARDS)
    (asserts! (> pass-threshold u0) ERR_INVALID_SCORE)
    (map-set course-rewards course-id
      {
        difficulty: difficulty,
        base-reward: base-reward,
        pass-threshold: pass-threshold
      }
    )
    (ok true)
  )
)

(define-public (enroll-user (course-id uint))
  (begin
    (map-set user-enrollments { user: tx-sender, course: course-id } true)
    (print { event: "user-enrolled", user: tx-sender, course: course-id })
    (ok true)
  )
)

(define-public (complete-course-and-claim
  (course-id uint)
  (quiz-results (list 10 uint))
  (proof (string-ascii 64))
)
  (let* (
    (enrolled (is-user-enrolled tx-sender course-id))
    (completion (get-user-completion tx-sender course-id))
    (already-done (is-course-completed completion))
    (valid-results (try! (validate-quiz-results quiz-results)))
    (valid-proof (try! (validate-proof proof)))
    (score (contract-call? .QuizManager score-quiz course-id quiz-results))
    (score-val (unwrap! score ERR_QUIZ_FAILED))
    (rewards (try! (calculate-rewards course-id score-val)))
    (config (unwrap! (map-get? course-rewards course-id) ERR_COURSE_NOT_FOUND))
    (threshold (get pass-threshold config))
    (pass? (>= score-val threshold))
    (cert (try! (generate-cert-id tx-sender course-id block-height)))
    (token-result (contract-call? .RewardToken mint tx-sender rewards))
    (progress-result (contract-call? .ProgressTracker complete-course tx-sender course-id))
    (mint-success (is-ok token-result))
    (progress-success (is-ok progress-result))
  )
    (asserts! enrolled ERR_NOT_ENROLLED)
    (asserts! (not already-done) ERR_ALREADY_COMPLETED)
    (asserts! pass? ERR_QUIZ_FAILED)
    (asserts! mint-success ERR_TOKEN_MINT_FAILED)
    (asserts! progress-success ERR_PROGRESS_UPDATE_FAILED)
    (var-set total-rewards-minted (+ (var-get total-rewards-minted) rewards))
    (map-set user-completions { user: tx-sender, course: course-id }
      {
        completed: true,
        score: score-val,
        timestamp: block-height,
        cert-id: cert
      }
    )
    (print {
      event: "course-completed",
      user: tx-sender,
      course: course-id,
      score: score-val,
      tokens: rewards,
      cert-id: cert
    })
    (ok {
      tokens-awarded: rewards,
      certification-id: cert,
      timestamp: block-height
    })
  )
)

(define-read-only (get-total-rewards-minted)
  (ok (var-get total-rewards-minted))
)