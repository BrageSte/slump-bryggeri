import type { Role } from "../../src/domain/model/api.ts";
import type { MeasurementUnitPreference } from "../../src/domain/model/brewing.ts";
import type { DB } from "./db.ts";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface MembershipContext {
  breweryId: string;
  breweryName: string;
  role: Role;
  unitPreference: MeasurementUnitPreference;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: DB;
    user: SessionUser;
    membership: MembershipContext;
  };
}
