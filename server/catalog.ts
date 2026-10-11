export interface RoomDefinition {
  id: string;
  name: string;
  capacity: number;
  description: string;
  features: readonly string[];
}

export const ROOMS: readonly RoomDefinition[] = [
  {
    id: "garden",
    name: "Сад",
    capacity: 4,
    description: "Комната для встреч и сосредоточенной работы.",
    features: [],
  },
  {
    id: "atelier",
    name: "Ателье",
    capacity: 6,
    description: "Пространство для совместной работы и обсуждений.",
    features: [],
  },
  {
    id: "forum",
    name: "Форум",
    capacity: 10,
    description: "Комната для встреч небольших команд.",
    features: [],
  },
];

export function findRoom(roomId: string): RoomDefinition | undefined {
  return ROOMS.find((room) => room.id === roomId);
}
