# Precificador 3D V4

A V4 mantém a página V3 na raiz e funciona em uma URL de validação separada:

`https://fabioho999.github.io/precificador3d-v3/v4/`

## Antes de validar

1. Abra o **SQL Editor** do projeto Supabase.
2. Execute todo o arquivo `supabase-v4.sql` como uma única migração.
3. Confirme que o script terminou sem erros e só então abra a URL V4.
4. Entre com a mesma conta usada no computador e no celular.

A chave presente no navegador é somente a chave pública do projeto. A V4 não usa nem expõe chave administrativa. As políticas RLS isolam os registros por conta e o bucket `order-assets` é privado.

## Migração dos dados V3

No primeiro acesso autenticado, a aplicação:

- baixa um backup JSON antes de escrever;
- inclui o `localStorage` V3, o snapshot legado disponível no Supabase e o estado V4 anterior;
- deduplica IDs e reconcilia pedidos, prazos e estoque;
- devolve reservas antigas de pedidos que não chegaram à produção;
- registra, sem descontar novamente, o consumo de pedidos já iniciados;
- mantém os dados V3 intactos para recuperação.

O marcador de migração e o cache IndexedDB são isolados por usuário. Dados locais já atribuídos a uma conta não são enviados para outra.

## Regras de estoque

- Salvar um orçamento não altera estoque.
- `Em produção` agrega todos os itens por rolo, valida o saldo e baixa uma vez.
- Cancelar antes da entrega devolve uma vez o consumo do ciclo.
- Pedido entregue não pode ser cancelado.
- Ajuste manual de filamento gera movimento auditável.

## Verificação local

Na pasta `v4`:

```powershell
node --check .\js\app.js
node --test .\tests\*.test.mjs
```

O roteiro manual de aceite está em `VALIDATION.md`. A raiz do GitHub Pages só deve ser trocada para a V4 depois dessa validação.
