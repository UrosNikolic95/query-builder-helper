# EXAMPLE 1

    const qb = new QuerySelectBuilderHelper(
        dataSource.getRepository(Test1Entity)
    );

    qb.addLeftJoinAnd({
        test_2: {
            id: 1,
            field: "qqq",
        },
    });

    // excluding objects can sometimes be tricky

    qb.exclude.addAnd({
        test_2: {
            test_1: {
                field: "abcd",
            },
        },
    });

    // include without duplicationg

    qb.include.addAnd({
        test_2: {
            test_1: {
                field: "abcd",
            },
        },
    });

    qb.addAnd({
        id: 20,
        test_2: {
            field: Operator.IsNull(),
        },
    });
    qb.addAnd({
        id: 22,
        test_2: {
            field: Operator.IsNotNull(),
        },
    });
    qb.addOrderBy([
        {
            path: (el) => el.test_2.id,
            order: "DESC",
        },
        {
            path: (el) => el.id,
        },
    ]);

    qb.limit(111);

    const data = await qb.getMany();

# EXAMPLE 2

    const d2 = new RawQueryHelper({
        repo: qb.repo,
        select: {
            A1: (el) => el.id,
            A2: (el) => el.test_2.id,
        },
    })
    .where({
      A1: 1,
      A2: Operator.IsNotNull(),
    })
    .addOrder({
      A1: "ASC",
      A2: "DESC",
    })
    .distinctOn({
      A1: true,
    });

const data2 = await d2.getRawMany();
