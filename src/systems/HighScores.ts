/**
 * High score persistence using localStorage.
 */

export interface HighScoreEntry {
  name: string;
  score: number;
  level: number;
  difficulty: string;
  seed: string;
  date: string;
}

const STORAGE_KEY = 'loderunner2099_highscores';
const MAX_SCORES = 10;

export class HighScores {
  private scores: HighScoreEntry[] = [];
  
  constructor() {
    this.load();
  }
  
  private load(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.scores = JSON.parse(data);
      }
    } catch (e) {
      console.warn('Failed to load high scores:', e);
      this.scores = [];
    }
  }
  
  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.scores));
    } catch (e) {
      console.warn('Failed to save high scores:', e);
    }
  }
  
  /**
   * Check if a score qualifies for the high score table
   */
  isHighScore(score: number): boolean {
    if (this.scores.length < MAX_SCORES) return true;
    return score > this.scores[this.scores.length - 1].score;
  }
  
  /**
   * Add a new high score entry
   * @returns The rank (1-based) or -1 if not a high score
   */
  addScore(entry: Omit<HighScoreEntry, 'date'>): number {
    const fullEntry: HighScoreEntry = {
      ...entry,
      date: new Date().toISOString().split('T')[0]
    };
    
    // Find insertion point
    let rank = this.scores.findIndex(s => entry.score > s.score);
    if (rank === -1) {
      if (this.scores.length < MAX_SCORES) {
        rank = this.scores.length;
      } else {
        return -1; // Not a high score
      }
    }
    
    // Insert and trim
    this.scores.splice(rank, 0, fullEntry);
    if (this.scores.length > MAX_SCORES) {
      this.scores = this.scores.slice(0, MAX_SCORES);
    }
    
    this.save();
    return rank + 1; // 1-based rank
  }
  
  /**
   * Get all high scores
   */
  getScores(): HighScoreEntry[] {
    return [...this.scores];
  }
  
  /**
   * Get high scores for a specific difficulty
   */
  getScoresForDifficulty(difficulty: string): HighScoreEntry[] {
    return this.scores.filter(s => s.difficulty === difficulty);
  }
  
  /**
   * Clear all high scores
   */
  clear(): void {
    this.scores = [];
    this.save();
  }
  
  /**
   * Get the top score
   */
  getTopScore(): HighScoreEntry | null {
    return this.scores.length > 0 ? this.scores[0] : null;
  }
  
  /**
   * Format scores for display
   */
  formatForDisplay(): string[] {
    return this.scores.map((s, i) => 
      `${(i + 1).toString().padStart(2, ' ')}. ${s.name.padEnd(8)} ${s.score.toString().padStart(7)} L${s.level.toString().padStart(2)} [${s.difficulty.substring(0, 3).toUpperCase()}]`
    );
  }
}

// Singleton
let instance: HighScores | null = null;

export function getHighScores(): HighScores {
  if (!instance) {
    instance = new HighScores();
  }
  return instance;
}
