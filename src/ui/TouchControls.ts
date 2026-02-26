import Phaser from 'phaser';
import { CONFIG } from '../config';

/**
 * Virtual touch controls for mobile devices.
 * Creates a D-pad and action buttons overlay.
 */
export class TouchControls {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private enabled: boolean = false;
  
  // Control state
  public left: boolean = false;
  public right: boolean = false;
  public up: boolean = false;
  public down: boolean = false;
  public digLeft: boolean = false;
  public digRight: boolean = false;
  
  // Just-pressed tracking
  private prevDigLeft: boolean = false;
  private prevDigRight: boolean = false;
  
  private buttons: Map<string, Phaser.GameObjects.Arc> = new Map();
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.container = scene.add.container(0, 0);
    this.container.setDepth(900);
    this.container.setAlpha(0.6);
    
    // Only show on mobile/tablet devices (not laptops with touchscreens)
    if (this.isMobileOrTablet()) {
      this.createControls();
      this.enabled = true;
    } else {
      this.container.setVisible(false);
    }
  }
  
  private isMobileOrTablet(): boolean {
    // Check for actual mobile/tablet devices, not just touch capability
    // Laptops with touchscreens should NOT show touch controls
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    const isTablet = /(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(userAgent);
    
    // Also check screen width - if wider than typical tablet, assume laptop
    const isSmallScreen = window.innerWidth <= 1024;
    
    // Must be mobile/tablet AND have touch AND be small screen
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    return hasTouch && (isMobile || isTablet) && isSmallScreen;
  }
  
  private createControls(): void {
    const buttonSize = 30;
    const dpadCenterX = 80;
    const dpadCenterY = CONFIG.GAME_HEIGHT - 80;
    const actionCenterX = CONFIG.GAME_WIDTH - 80;
    const actionCenterY = CONFIG.GAME_HEIGHT - 80;
    const spacing = 45;
    
    // D-pad background
    const dpadBg = this.scene.add.circle(dpadCenterX, dpadCenterY, 70, 0x000000, 0.3);
    this.container.add(dpadBg);
    
    // D-pad buttons
    this.createButton('up', dpadCenterX, dpadCenterY - spacing, buttonSize, 0x00aaaa, '▲');
    this.createButton('down', dpadCenterX, dpadCenterY + spacing, buttonSize, 0x00aaaa, '▼');
    this.createButton('left', dpadCenterX - spacing, dpadCenterY, buttonSize, 0x00aaaa, '◀');
    this.createButton('right', dpadCenterX + spacing, dpadCenterY, buttonSize, 0x00aaaa, '▶');
    
    // Action buttons background
    const actionBg = this.scene.add.circle(actionCenterX, actionCenterY, 70, 0x000000, 0.3);
    this.container.add(actionBg);
    
    // Action buttons (dig left/right)
    this.createButton('digLeft', actionCenterX - spacing, actionCenterY, buttonSize, 0xaa0000, 'Z');
    this.createButton('digRight', actionCenterX + spacing, actionCenterY, buttonSize, 0xaa0000, 'X');
    
    // Labels
    const labelStyle = { fontFamily: 'monospace', fontSize: '10px', color: '#888888' };
    const dpadLabel = this.scene.add.text(dpadCenterX, dpadCenterY - 85, 'MOVE', labelStyle);
    dpadLabel.setOrigin(0.5);
    this.container.add(dpadLabel);
    
    const digLabel = this.scene.add.text(actionCenterX, actionCenterY - 55, 'DIG', labelStyle);
    digLabel.setOrigin(0.5);
    this.container.add(digLabel);
  }
  
  private createButton(name: string, x: number, y: number, radius: number, color: number, label: string): void {
    const button = this.scene.add.circle(x, y, radius, color, 0.7);
    button.setStrokeStyle(2, 0xffffff, 0.5);
    button.setInteractive();
    
    const text = this.scene.add.text(x, y, label, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff'
    });
    text.setOrigin(0.5);
    
    this.container.add(button);
    this.container.add(text);
    this.buttons.set(name, button);
    
    // Touch events
    button.on('pointerdown', () => this.setButtonState(name, true));
    button.on('pointerup', () => this.setButtonState(name, false));
    button.on('pointerout', () => this.setButtonState(name, false));
  }
  
  private setButtonState(name: string, pressed: boolean): void {
    const button = this.buttons.get(name);
    if (button) {
      button.setScale(pressed ? 0.9 : 1);
      button.setAlpha(pressed ? 1 : 0.7);
    }
    
    switch (name) {
      case 'up': this.up = pressed; break;
      case 'down': this.down = pressed; break;
      case 'left': this.left = pressed; break;
      case 'right': this.right = pressed; break;
      case 'digLeft': this.digLeft = pressed; break;
      case 'digRight': this.digRight = pressed; break;
    }
  }
  
  /**
   * Check if dig button was just pressed this frame
   */
  justPressedDigLeft(): boolean {
    const result = this.digLeft && !this.prevDigLeft;
    this.prevDigLeft = this.digLeft;
    return result;
  }
  
  justPressedDigRight(): boolean {
    const result = this.digRight && !this.prevDigRight;
    this.prevDigRight = this.digRight;
    return result;
  }
  
  update(): void {
    // Update previous state for just-pressed detection
    // Called at end of frame
  }
  
  updatePrevState(): void {
    this.prevDigLeft = this.digLeft;
    this.prevDigRight = this.digRight;
  }
  
  isEnabled(): boolean {
    return this.enabled;
  }
  
  setVisible(visible: boolean): void {
    this.container.setVisible(visible && this.enabled);
  }
  
  destroy(): void {
    this.container.destroy();
  }
}
