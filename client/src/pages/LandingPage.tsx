import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { isValidEmail } from '@/utils/validateEmail';

export default function LandingPage() {
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [waitlistError, setWaitlistError] = useState('');

  const handleWaitlistSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setWaitlistError('');

      if (!waitlistEmail || !isValidEmail(waitlistEmail)) {
        setWaitlistError('Please enter a valid email address.');
        return;
      }

      // In a real app this would POST to an API. For now, simulate success.
      setWaitlistSubmitted(true);
    },
    [waitlistEmail],
  );

  const scrollToSection = useCallback((e: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    e.preventDefault();
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      // Update URL hash without jumping
      window.history.pushState(null, '', `#${sectionId}`);
    }
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg scroll-smooth overflow-x-hidden">
      {/* ───── Header / Navigation ───── */}
      <header className="sticky top-0 z-50 bg-white/90 dark:bg-dark-bg/90 backdrop-blur border-b border-gray-100 dark:border-dark-border">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between">
          <span className="text-xl sm:text-2xl font-bold text-primary-600 shrink-0">me.md</span>

          {/* Section navigation links - hidden on mobile */}
          <nav className="hidden md:flex items-center gap-6">
            <a
              href="#how-it-works"
              onClick={(e) => scrollToSection(e, 'how-it-works')}
              className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              How It Works
            </a>
            <a
              href="#features"
              onClick={(e) => scrollToSection(e, 'features')}
              className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              Features
            </a>
            <a
              href="#social-proof"
              onClick={(e) => scrollToSection(e, 'social-proof')}
              className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              Why me.md
            </a>
            <a
              href="#waitlist"
              onClick={(e) => scrollToSection(e, 'waitlist')}
              className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              Join Beta
            </a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <Link
              to="/login"
              className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Sign In
            </Link>
            <Link to="/register" className="btn-primary text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* ───── Hero Section ───── */}
      <section id="hero" className="max-w-6xl mx-auto px-4 py-12 sm:py-20 md:py-28 text-center">
        <div className="inline-block mb-4 sm:mb-6 px-3 sm:px-4 py-1.5 rounded-full bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300 text-xs sm:text-sm font-medium">
          Closed Beta — Limited Spots Available
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold text-gray-900 dark:text-white mb-4 sm:mb-6 leading-tight">
          Your Verified Personal Context
        </h1>
        <p className="text-base sm:text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto mb-3 sm:mb-4 leading-relaxed">
          Build a comprehensive understanding of yourself through AI-guided conversations.
          Make any AI tool write, decide, and act like you — with{' '}
          <span className="font-semibold text-primary-600 dark:text-primary-400">95%+ accuracy</span>{' '}
          instead of the 53-67% offered by passive memory systems.
        </p>
        <p className="text-sm sm:text-base text-gray-500 dark:text-gray-300 max-w-2xl mx-auto mb-8 sm:mb-10">
          me.md uses structured interviews with proven questioning methodologies to actively extract
          personal knowledge, then puts you in full control through human-in-the-loop verification
          of every insight.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
          <Link to="/register" className="btn-primary text-base sm:text-lg px-6 sm:px-8 py-3 w-full sm:w-auto text-center">
            Start Building Your me.md
          </Link>
          <a
            href="#how-it-works"
            onClick={(e) => scrollToSection(e, 'how-it-works')}
            className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium transition-colors"
          >
            Learn how it works &darr;
          </a>
        </div>
      </section>

      {/* ───── Three Pillars: Create, Verify, Manage ───── */}
      <section id="how-it-works" className="bg-gray-50 dark:bg-dark-surface py-12 sm:py-20">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-gray-900 dark:text-white mb-3 sm:mb-4">
            Three Steps to Your Personal AI Context
          </h2>
          <p className="text-center text-sm sm:text-base text-gray-500 dark:text-gray-300 max-w-2xl mx-auto mb-8 sm:mb-12">
            A simple, human-centred process that keeps you in control at every step.
          </p>
          <div className="grid md:grid-cols-3 gap-6 sm:gap-8">
            {[
              {
                title: 'Create',
                description:
                  'AI-guided interviews using proven questioning methodologies — Socratic, Clean Language, Appreciative Inquiry — extract your personal knowledge, values, and decision patterns.',
                icon: '💬',
                step: '1',
              },
              {
                title: 'Verify',
                description:
                  'You stay in full control. Review and verify every insight — approve, reject, or edit. Nothing goes into your profile without your explicit approval.',
                icon: '✅',
                step: '2',
              },
              {
                title: 'Manage',
                description:
                  'Export your verified context as a portable me.md file or serve it via MCP. Any AI tool can use it to truly understand you.',
                icon: '📤',
                step: '3',
              },
            ].map((pillar) => (
              <div key={pillar.title} className="card text-center relative pt-8 sm:pt-6">
                <div className="absolute -top-3 left-4 sm:-left-3 w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-bold">
                  {pillar.step}
                </div>
                <div className="text-3xl sm:text-4xl mb-3 sm:mb-4">{pillar.icon}</div>
                <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-2 sm:mb-3">
                  {pillar.title}
                </h3>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed">
                  {pillar.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── Feature Highlights ───── */}
      <section id="features" className="py-12 sm:py-20">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-gray-900 dark:text-white mb-3 sm:mb-4">
            Everything You Need to Know Yourself Better
          </h2>
          <p className="text-center text-sm sm:text-base text-gray-500 dark:text-gray-300 max-w-2xl mx-auto mb-8 sm:mb-12">
            Powerful tools designed to build, verify, and manage a living knowledge graph of who you are.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {[
              {
                icon: '🧠',
                label: 'Structured Interviews',
                desc: 'Proven methodologies like Socratic questioning, Clean Language, and 5 Whys extract deep self-knowledge.',
              },
              {
                icon: '🛡️',
                label: 'Human-in-the-Loop',
                desc: 'Every insight verified by you before it becomes part of your profile. Approve, reject, or edit.',
              },
              {
                icon: '🔗',
                label: 'Knowledge Graph',
                desc: 'Visual interactive graph showing connections between your topics, insights, and concepts.',
              },
              {
                icon: '📄',
                label: 'Portable Context',
                desc: 'Export as me.md markdown or JSON for any AI tool, or serve via MCP protocol to compatible agents.',
              },
              {
                icon: '🧪',
                label: 'Context Sandbox',
                desc: 'Test your verified context side-by-side: see the difference your me.md makes on real prompts.',
              },
              {
                icon: '🔍',
                label: 'Smart Search',
                desc: 'Search across topics, insights, session transcripts, and notes. Filter by status, date, and confidence.',
              },
              {
                icon: '⚡',
                label: 'Quick-Win Sessions',
                desc: '5-minute mini interviews with high-impact questions that generate your first verified insights fast.',
              },
              {
                icon: '📊',
                label: 'Analytics Dashboard',
                desc: 'Track knowledge completeness, verification rates, session history, and insights per topic.',
              },
              {
                icon: '🎙️',
                label: 'Voice Input',
                desc: 'Speak your answers naturally with built-in voice-to-text — perfect for on-the-go self-discovery.',
              },
            ].map((feature) => (
              <div
                key={feature.label}
                className="p-4 sm:p-5 rounded-xl bg-gray-50 dark:bg-dark-surface border border-gray-100 dark:border-dark-border hover:border-primary-200 dark:hover:border-primary-800 transition-colors"
              >
                <div className="text-2xl mb-2 sm:mb-3">{feature.icon}</div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">{feature.label}</h4>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── Social Proof / Why me.md ───── */}
      <section id="social-proof" className="bg-gray-50 dark:bg-dark-surface py-12 sm:py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-gray-900 dark:text-white mb-3 sm:mb-4">
            Why me.md?
          </h2>
          <p className="text-center text-sm sm:text-base text-gray-500 dark:text-gray-300 max-w-2xl mx-auto mb-8 sm:mb-12">
            Most AI memory systems capture 53-67% of who you are. me.md uses structured interviews
            and human verification to achieve{' '}
            <span className="font-semibold text-primary-600 dark:text-primary-400">95%+ accuracy</span>{' '}
            — a living knowledge graph of your verified personal context.
          </p>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 sm:gap-6 mb-10 sm:mb-16">
            {[
              { value: '95%+', label: 'Context Accuracy', note: 'vs 53-67% with passive memory' },
              { value: '5 min', label: 'First Insights', note: 'Quick-win mini sessions' },
              { value: '100%', label: 'Human Verified', note: 'You approve every insight' },
            ].map((stat) => (
              <div key={stat.label} className="text-center p-3 sm:p-6 rounded-xl bg-white dark:bg-dark-bg">
                <div className="text-2xl sm:text-4xl font-bold text-primary-600 dark:text-primary-400 mb-1">
                  {stat.value}
                </div>
                <div className="font-medium text-xs sm:text-base text-gray-900 dark:text-white mb-0.5 sm:mb-1">{stat.label}</div>
                <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-300 leading-tight">{stat.note}</div>
              </div>
            ))}
          </div>

          {/* Testimonials / Social proof cards */}
          <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
            {[
              {
                quote:
                  'After just three sessions, my AI emails actually sound like me. My team noticed the difference immediately.',
                author: 'Early Beta Tester',
                role: 'Engineering Manager',
              },
              {
                quote:
                  "The verification step is what sets this apart. I trust the output because I approved every insight that shapes it.",
                author: 'Early Beta Tester',
                role: 'Product Designer',
              },
            ].map((testimonial, idx) => (
              <div
                key={idx}
                className="p-4 sm:p-6 rounded-xl bg-white dark:bg-dark-bg border border-gray-100 dark:border-dark-border"
              >
                <svg
                  className="w-6 h-6 sm:w-8 sm:h-8 text-primary-200 dark:text-primary-800 mb-2 sm:mb-3"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
                </svg>
                <p className="text-sm sm:text-base text-gray-700 dark:text-gray-300 mb-3 sm:mb-4 italic leading-relaxed">
                  "{testimonial.quote}"
                </p>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white text-sm">
                    {testimonial.author}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-300">{testimonial.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── Closed Beta CTA / Waitlist Signup ───── */}
      <section id="waitlist" className="bg-primary-600 py-10 sm:py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3 sm:mb-4">
            Ready to teach AI who you are?
          </h2>
          <p className="text-primary-100 mb-6 sm:mb-8 text-base sm:text-lg">
            Join the closed beta and start building your verified personal context.
          </p>

          {waitlistSubmitted ? (
            <div className="inline-flex items-center gap-2 bg-white/20 text-white px-4 sm:px-6 py-3 rounded-lg font-medium text-sm sm:text-base">
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              You&apos;re on the list! We&apos;ll be in touch soon.
            </div>
          ) : (
            <form
              onSubmit={handleWaitlistSubmit}
              className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto"
            >
              <div className="w-full sm:flex-1">
                <label htmlFor="waitlist-email" className="sr-only">
                  Email address
                </label>
                <input
                  id="waitlist-email"
                  type="email"
                  placeholder="you@example.com"
                  value={waitlistEmail}
                  onChange={(e) => {
                    setWaitlistEmail(e.target.value);
                    setWaitlistError('');
                  }}
                  className="w-full px-4 py-3 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white text-base"
                  autoComplete="email"
                />
                {waitlistError && (
                  <p className="text-primary-200 text-xs mt-1 text-left">{waitlistError}</p>
                )}
              </div>
              <button
                type="submit"
                className="w-full sm:w-auto whitespace-nowrap bg-white text-primary-600 px-6 py-3 rounded-lg font-semibold hover:bg-primary-50 transition-colors focus:outline-none focus:ring-2 focus:ring-white min-h-[48px]"
              >
                Join Waitlist
              </button>
            </form>
          )}

          <p className="text-primary-200 text-xs mt-4">
            No spam, ever. We&apos;ll only email you when your spot is ready.
          </p>

          <div className="mt-6">
            <Link
              to="/register"
              className="text-white/80 hover:text-white font-medium text-sm underline underline-offset-2 transition-colors"
            >
              Already have an invite? Sign up here &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* ───── Footer ───── */}
      <footer className="border-t border-gray-200 dark:border-dark-border py-6 sm:py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
          <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-300 text-center sm:text-left">
            &copy; 2026 me.md. Your verified personal context for AI.
          </div>
          <nav className="flex items-center gap-4 sm:gap-6">
            <a
              href="#how-it-works"
              onClick={(e) => scrollToSection(e, 'how-it-works')}
              className="text-xs text-gray-500 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              How It Works
            </a>
            <a
              href="#features"
              onClick={(e) => scrollToSection(e, 'features')}
              className="text-xs text-gray-500 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              Features
            </a>
            <a
              href="#waitlist"
              onClick={(e) => scrollToSection(e, 'waitlist')}
              className="text-xs text-gray-500 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              Join Beta
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
