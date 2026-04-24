import { redirect } from "next/navigation";

export default function NotesRedirect(): never {
  redirect("/bins");
}
