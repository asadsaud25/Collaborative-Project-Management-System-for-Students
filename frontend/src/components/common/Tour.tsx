import { driver } from "driver.js";
import "driver.js/dist/driver.css";

const KEY = "cpms_tour_done";
export const tourSeen = () => localStorage.getItem(KEY) === "1";

/** Step-by-step first-login tour. Targets elements marked with data-tour="...". */
export function startTour() {
  const d = driver({
    showProgress: true, allowClose: true, nextBtnText: "Next", prevBtnText: "Back", doneBtnText: "Done",
    onDestroyed: () => localStorage.setItem(KEY, "1"),
    steps: [
      { popover: { title: "Welcome to CPMS", description: "A 30-second tour of where things live. You can replay it anytime from the user menu." } },
      { element: '[data-tour="nav-dashboard"]', popover: { title: "Your dashboard", description: "Your tasks, deadlines, personal progress and review queue. What you see depends on your role." } },
      { element: '[data-tour="nav-projects"]', popover: { title: "Projects", description: "Open a project for the Kanban board, Gantt chart, calendar, milestones, GitHub activity, ideas and meetings." } },
      { element: '[data-tour="nav-discover"]', popover: { title: "Find a project", description: "Browse public projects and send a join request. The owner approves or declines it." } },
      { element: '[data-tour="nav-messages"]', popover: { title: "Messages and forum", description: "Private messages with teammates and supervisors, plus a community forum for questions." } },
      { element: '[data-tour="bell"]', popover: { title: "Notifications", description: "Task assignments, review results, join requests, meetings and deadline alerts arrive here live." } },
      { element: '[data-tour="user-menu"]', popover: { title: "Milestones and profile", description: "Fill in your profile and GitHub username so commits can be linked to your milestone submissions. Mark a milestone complete inside a project and your lead reviews it." } },
    ],
  });
  d.drive();
}
