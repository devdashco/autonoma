import type {
    AssertCommandSpec,
    ClickCommandSpec,
    HoverCommandSpec,
    RefreshCommandSpec,
    ScrollCommandSpec,
    TypeCommandSpec,
} from "@autonoma/engine";

/** The possible commands that the web replay engine can execute. */
export type ReplayWebCommandSpec =
    | ClickCommandSpec
    | HoverCommandSpec
    | TypeCommandSpec
    | AssertCommandSpec
    | ScrollCommandSpec
    | RefreshCommandSpec;
