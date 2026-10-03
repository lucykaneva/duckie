'use client';

import { useEffect, useRef } from 'react';
import { DuckParticles } from './DuckParticles';
import styles from './DuckHero.module.css';

interface Props {
  /** Extra class for the root, e.g. a next/font variable. */
  className?: string;
  /** Artwork the particles sample from. */
  src?: string;
}

/** Landing hero: the particle duck assembles on load and disperses as the page scrolls. */
export default function DuckHero({ className = '', src = '/landing/duck.png' }: Props) {
  const trackRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!trackRef.current || !stageRef.current) return;
    const duck = new DuckParticles({ container: stageRef.current, scrollTrack: trackRef.current, src });
    duck.init().catch((err) => console.error('Duck particles failed to start:', err));
    return () => duck.dispose();
  }, [src]);

  return (
    <div className={`${styles.page} ${className}`}>
      <section className={styles.hero} ref={trackRef}>
        <div className={styles.stage} ref={stageRef}>
          <div className={styles.copy}>
            <p className={styles.eyebrow}>The Study Duck</p>
            <h1 className={styles.title}>
              You say you know?
              <br />
              Prove it to duckie
            </h1>
            <p className={styles.lede}>Talk it through out loud. Find out what you actually understand.</p>
          </div>
          <p className={styles.scrollHint} aria-hidden="true">
            Scroll
          </p>
        </div>
      </section>

      <section className={styles.next}>
        <h2>You teach. The duck listens.</h2>
        <p>
          Upload your slides, pick a topic, and explain it. The duck asks the questions that show you where the gaps
          are.
        </p>
      </section>
    </div>
  );
}
