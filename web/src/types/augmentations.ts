import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      googleId?: string;
    };
  }

  interface User {
    googleId?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId?: string;
    googleId?: string;
  }
}

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: boolean | "";
  }
}

export {};
