"use client";

/**
 * DRVN clickable mockup.
 *
 * A self-contained prototype of the read.cv-style product flow:
 *   Profile → Car Profile (About / Activity) → Activity detail, plus Explore and Settings.
 *
 * All navigation is client-side state held here; the screens are presentational.
 */

import Link from "next/link";
import { useState } from "react";

import { person } from "./data";
import { ActivityDetailScreen, CarScreen, ExploreScreen, ProfileScreen, SettingsScreen } from "./screens";
import { type NavKey, Sidebar } from "./ui";

type View = "profile" | "car" | "activity" | "explore" | "settings";

interface MockupState {
  view: View;
  profileTab: string;
  carId: string;
  carTab: string;
  postId: string;
  exploreSort: string;
  settingsSection: string;
}

const INITIAL_STATE: MockupState = {
  view: "profile",
  profileTab: "About",
  carId: person.cars[0].id,
  carTab: "About",
  postId: person.cars[0].activity[0].id,
  exploreSort: "Trending",
  settingsSection: "Profile",
};

export default function MockupPage() {
  const [state, setState] = useState<MockupState>(INITIAL_STATE);

  const update = (patch: Partial<MockupState>) => setState((prev) => ({ ...prev, ...patch }));

  const activeCar = person.cars.find((car) => car.id === state.carId) ?? person.cars[0];
  const activePost = activeCar.activity.find((post) => post.id === state.postId) ?? activeCar.activity[0];

  const handleNavigate = (key: NavKey) => {
    if (key === "profile") update({ view: "profile" });
    if (key === "explore") update({ view: "explore" });
    if (key === "settings") update({ view: "settings" });
  };

  const openCar = (carId: string) => update({ view: "car", carId, carTab: "About" });

  const openActivity = (carId: string, postId: string) => update({ view: "activity", carId, postId });

  const sidebarActive: NavKey =
    state.view === "explore" ? "explore" : state.view === "settings" ? "settings" : "profile";

  return (
    <div className="min-h-screen bg-[#1A1D1F] text-[#EEEEEE]">
      <div className="flex">
        <Sidebar active={sidebarActive} onNavigate={handleNavigate} />

        <main className="min-h-screen flex-1">
          {state.view === "profile" ? (
            <ProfileScreen
              tab={state.profileTab}
              onTab={(tab) => update({ profileTab: tab })}
              onOpenCar={openCar}
              onOpenActivity={openActivity}
            />
          ) : null}

          {state.view === "car" ? (
            <CarScreen
              car={activeCar}
              tab={state.carTab}
              onTab={(tab) => update({ carTab: tab })}
              onBack={() => update({ view: "profile" })}
              onOpenActivity={openActivity}
            />
          ) : null}

          {state.view === "activity" ? (
            <ActivityDetailScreen
              post={activePost}
              onBack={() => update({ view: "car", carTab: "Activity" })}
            />
          ) : null}

          {state.view === "explore" ? (
            <ExploreScreen sort={state.exploreSort} onSort={(sort) => update({ exploreSort: sort })} />
          ) : null}

          {state.view === "settings" ? (
            <SettingsScreen
              section={state.settingsSection}
              onSection={(section) => update({ settingsSection: section })}
            />
          ) : null}
        </main>
      </div>

      <Link
        href="/design-system"
        className="fixed bottom-5 right-5 z-10 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-[#BBBBBB] backdrop-blur transition hover:bg-white/10 hover:text-white"
      >
        Design system
      </Link>
    </div>
  );
}
