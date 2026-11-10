Vamos preparar a exportação dos dados do sistema para uma mudança de servidor. Não mexa em telas, tabelas, dados, políticas nem em nada que já existe.

Crie uma migration com EXATAMENTE o SQL abaixo, sem alterar nada, e aplique. Ela cria uma função temporária e só de leitura (STABLE): ela não grava nada e, sem o token certo, só devolve erro. Vamos apagá-la depois da mudança. Não precisa criar tela, rota nem publicar o app — só o banco muda.

__SQL__
