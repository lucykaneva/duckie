'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DuckParticles } from './DuckParticles';
import styles from './DuckHero.module.css';

interface Props {
  /** Extra class for the root, e.g. a next/font variable. */
  className?: string;
  /** Artwork the particles sample from. */
  src?: string;
}

/** Landing: the duck alone, then the line, then Courses. */
export default function DuckHero({ className = '', src = '/landing/duck.png' }: Props) {
  const router = useRouter();
  const trackRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [cue, setCue] = useState(false);

  useEffect(() => {
    if (!trackRef.current || !stageRef.current) return;
    let formedTimer = 0;
    let cancelled = false;
    const duck = new DuckParticles({
      container: stageRef.current,
      scrollTrack: trackRef.current,
      src,
      onFormed: () => {
        // Pause after the duck settles, then reveal the cue. Not a page-load timer.
        formedTimer = window.setTimeout(() => {
          if (!cancelled) setCue(true);
        }, 650);
      },
    });
    duck.init().catch((err) => console.error('Duck particles failed to start:', err));
    return () => {
      cancelled = true;
      window.clearTimeout(formedTimer);
      duck.dispose();
    };
  }, [src]);

  useEffect(() => {
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!track || !stage) return;

    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);

    let left = false;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    function progressOf() {
      const rect = track!.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      return Math.min(1, Math.max(0, -rect.top / travel));
    }

    function onScroll() {
      const progress = progressOf();
      // The line finishes appearing at 0.582. It then holds, rises off the top, and Courses opens.
      const fade = Math.min(1, Math.max(0, (progress - 0.441) / 0.141));
      const rise = reduce ? 0 : Math.min(1, Math.max(0, (progress - 0.64) / 0.33));
      stage!.style.setProperty('--headline', fade.toFixed(3));
      stage!.style.setProperty('--rise', rise.toFixed(3));
      stage!.style.setProperty('--hint', (1 - Math.min(1, progress / 0.124)).toFixed(3));
      if (!left && (reduce ? progress > 0.926 : rise >= 1)) {
        left = true;
        router.push('/courses');
      }
    }

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      history.scrollRestoration = previous;
    };
  }, [router]);

  return (
    <div className={`${styles.page} ${className}`}>
      <section className={styles.hero} ref={trackRef}>
        <div className={styles.stage} ref={stageRef}>
          <h1 className={styles.title}>
            You say you know?
            <br />
            Prove it to duckie
          </h1>
          <p className={`${styles.hint} ${cue ? styles.formed : ''}`} aria-hidden="true">
            <span className={styles.veil}>
              <span className={styles.cue}>
                <span>Scroll down</span>
                <svg className={styles.arrow} viewBox="0 0 28 36" fill="none" aria-hidden="true">
                  <path
                    d="M14.2 3.5c.3 7.2-.4 13.4.6 20.2"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                  <path
                    d="M7.4 18.6c2.2 3.4 4.6 5.6 6.8 6.6 2 .8 4.1-.4 6.6-3.4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}
