import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import Sidebar from "./Sidebar";
import GroomingWorkspace from "./GroomingWorkspace";
import PRReviewPanel from "./PRReviewPanel";
import DevLog from "./DevLog";
import TeamMembers from "./TeamMembers";
import StoryReadiness from "./StoryReadiness";

type Tab = "groom" | "pr-review" | "activity" | "readiness" | "team";

export default function Layout() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("pr-review");
  const [selectedStory, setSelectedStory] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedPrUrl, setSelectedPrUrl] = useState<string | null>(null);

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle("dark");
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      {sidebarOpen && (
        <Sidebar
          onSelectStory={(key) => {
            setSelectedStory(key);
            setActiveTab("groom");
          }}
          onSelectPR={(url) => {
            setSelectedPrUrl(url);
            setActiveTab("pr-review");
          }}
          selectedStory={selectedStory}
          activeTab={activeTab}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-sm mr-1"
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              {sidebarOpen ? "◀" : "▶"}
            </button>
            <span className="text-xl mr-2">🧹</span>
            <h1 className="text-lg font-semibold">GroomPilot</h1>
          </div>

          <nav className="flex items-center gap-1">
            {(["pr-review", "groom", "readiness", "activity", "team"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                {tab === "groom" && "📋 Groom"}
                {tab === "pr-review" && "🔍 PR Review"}
                {tab === "readiness" && "📊 Readiness"}
                {tab === "activity" && "📈 Activity"}
                {tab === "team" && "👥 Team"}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleDarkMode}
              className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
            >
              {darkMode ? "☀️" : "🌙"}
            </button>
            <div className="flex items-center gap-2">
              {user?.avatarUrl && (
                <img src={user.avatarUrl} alt="" className="w-7 h-7 rounded-full" />
              )}
              <span className="text-sm font-medium">{user?.username}</span>
            </div>
            <button
              onClick={logout}
              className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Tab Content */}
        <main className="flex-1 overflow-auto p-4">
          {activeTab === "groom" && (
            <GroomingWorkspace selectedStory={selectedStory} />
          )}
          {activeTab === "pr-review" && <PRReviewPanel initialPrUrl={selectedPrUrl} onPrUrlConsumed={() => setSelectedPrUrl(null)} />}
          {activeTab === "readiness" && <StoryReadiness />}
          {activeTab === "activity" && <DevLog />}
          {activeTab === "team" && <TeamMembers />}
        </main>
      </div>
    </div>
  );
}
