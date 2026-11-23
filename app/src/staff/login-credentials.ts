export function readPasswordCredentials(form: HTMLFormElement): { username: string; password: string } {
  const username = form.elements.namedItem('user') as HTMLInputElement | null;
  const password = form.elements.namedItem('pass') as HTMLInputElement | null;
  return { username: username?.value ?? '', password: password?.value ?? '' };
}
