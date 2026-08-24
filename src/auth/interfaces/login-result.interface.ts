export interface AuthenticatedOperator {
  id: number;
  remoteUserId: number;
  email: string;
  name: string;
  /** Espelha o enum `status` do Checkin Pai: manager=0, admin=1, staff=2, user=3. */
  status: number;
  /** Espelha o enum `course_type` do Checkin Pai: full=0, formation=1, event=2. */
  courseType: number;
}

export interface LoginResult {
  accessToken: string;
  operator: AuthenticatedOperator;
}
