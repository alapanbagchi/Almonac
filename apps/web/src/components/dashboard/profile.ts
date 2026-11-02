export interface CurrentUser {
  name: string;
  designation: string;
  avatar: string;
}

// TODO: swap for backend data when the user endpoint lands.
export const CURRENT_USER: CurrentUser = {
  name: "Alex Morgan",
  designation: "Hospital Administrator",
  avatar: "/profile/avatar.svg",
};
