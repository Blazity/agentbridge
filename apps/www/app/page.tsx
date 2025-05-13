import { BookOpen, ChevronRight, Github } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col px-6 py-16 max-w-4xl mx-auto">
      <div className="mb-16 flex justify-center">
        <a
          href="https://blazity.com/blog/agentbridge-open-source-api-integration-framework"
          target="_blank"
          rel="noopener noreferrer"
          className="py-2 px-4 bg-white rounded-full flex items-center gap-1 text-gray-700 hover:text-black transition-all shadow-[0_0_20px_rgba(245,101,39,0.3)] hover:shadow-[0_0_30px_rgba(245,101,39,0.5)] border border-gray-100"
        >
          <span>See our launch post</span>
          <ChevronRight size={16} />
        </a>
      </div>

      <header className="mb-16">
        <h1 className="text-4xl font-semibold mb-16">AgentBridge</h1>

        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-medium mb-3">What?</h2>
            <p className="text-lg text-gray-700">
              AgentBridge is a comprehensive framework for simplifying API
              integration with AI agents. We provide a standardized,
              semantically enhanced format that bridges complex API
              specifications with AI agent capabilities.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-medium mb-3">Why?</h2>
            <p className="text-lg text-gray-700">
              Because integrating APIs with Large Language Models is complex.
              Traditional API specifications are designed for human developers,
              not AI agents, leading to inefficient workflows and limited
              capabilities.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-medium mb-3">How?</h2>
            <p className="text-lg text-gray-700">
              By creating a universal standard that transforms API
              specifications into semantically enhanced formats. Our framework
              bridges the gap between complex endpoint documentation and
              AI-readable structures, enabling more effective agent interactions
              with third-party services.
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 mb-16">
        <div className="flex flex-row space-x-6">
          <a
            href="https://github.com/Blazity/agentbridge"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 border border-gray-200 rounded-lg p-6 flex items-center gap-4 transition-all hover:border-blazity-orange hover:border-2"
          >
            <Github size={24} className="text-blazity-orange" />
            <span className="text-lg">GitHub</span>
          </a>

          <a
            href="https://docs.blazity.com/agent-bridge"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 border border-gray-200 rounded-lg p-6 flex items-center gap-4 transition-all hover:border-blazity-orange hover:border-2"
          >
            <BookOpen size={24} className="text-blazity-orange" />
            <span className="text-lg">Documentation</span>
          </a>
        </div>
      </main>

      <footer className="text-center">
        <span>Made by</span>
        <svg
          width="23"
          height="23"
          viewBox="0 0 23 23"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="mx-1 inline-block h-4 w-4"
        >
          <g clipPath="url(#clip0_1_2)">
            <path
              d="M9.59532 3.45696C9.59532 3.45696 14.2046 5.46461 16.9277 8.36518C19.6509 11.2658 20.6296 16.1778 16.9277 19.1825C13.2259 22.1882 9.28386 19.8672 7.60986 17.9608C5.93586 16.0544 3.20693 10.1501 3.20693 10.1501L5.77385 11.2648L0.196426 0L10.6281 5.91107L9.59532 3.45696Z"
              fill="#FF4400"
            />
            <path
              d="M22.375 14.8413C22.375 19.4265 18.6519 23.1429 14.058 23.1429C9.46418 23.1429 5.74107 19.4265 5.74107 14.8413C5.74107 10.2571 9.46514 6.54075 14.058 6.54075C18.6519 6.54075 22.375 10.2571 22.375 14.8413Z"
              fill="#FF4400"
            />
          </g>
          <defs>
            <clipPath id="clip0_1_2">
              <rect width="23" height="23" fill="white" />
            </clipPath>
          </defs>
        </svg>{" "}
        <span>
          <a
            href="https://blazity.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blazity-orange underline underline-offset-4"
          >
            Blazity
          </a>
        </span>
      </footer>
    </div>
  );
}
