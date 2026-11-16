export declare const SEED_PBKDF2_ITERATIONS: number;
export declare const DEFAULT_SEED_ADMIN_USERNAME: string;

export declare function hashSeedPassword(
  password: string,
  saltBytes?: Buffer
): string;

export declare function generateSeedCredential(): {
  password: string;
  passwordHash: string;
};

export declare function seedUpsertSql(
  username: string,
  passwordHash: string
): string;
