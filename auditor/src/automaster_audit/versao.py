"""Conferência das versões dos manifestos do plugin."""


def versao_minima_ok(versoes: dict[str, str], minimo: tuple[int, int, int]) -> bool:
    """True quando todas as versões são iguais entre si e, comparadas como números, >= `minimo`."""
    unicas = set(versoes.values())
    if len(unicas) != 1:
        return False
    return tuple(map(int, unicas.pop().split("."))) >= minimo
