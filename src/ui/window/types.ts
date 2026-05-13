export type WindowAnchor = "top-left" | "top-right" | "top-center" | "bottom-center" | "center";

export type WindowPlacement = {
  anchor: WindowAnchor;
  width: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
  mobile?: Omit<WindowPlacement, "mobile">;
};

export type GameWindowOptions = {
  id: string;
  title: string;
  content: HTMLElement;
  placement: WindowPlacement;
  className?: string;
  movable?: boolean;
  closable?: boolean;
  lockable?: boolean;
  locked?: boolean;
  modal?: boolean;
  hidden?: boolean;
  onClose?: () => void;
};
