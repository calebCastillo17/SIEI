import type { UserInput } from '../api/types';

export function emptyUserInput(): UserInput {
  return {
    email: '',
    nombre: ''
  };
}
